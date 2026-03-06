import fp from "fastify-plugin";
import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { generateText, Output, type LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import type { GameAction, GameStateSnapshot } from "../types.js";
import { getTemplate } from "../lib/templates.js";
import { evaluateHand } from "../lib/hand-evaluator.js";

export type LlmProvider = "gemini" | "openrouter";

const GameActionSchema = z.object({
  type: z.enum(["fold", "check", "call", "raise", "all_in"]).describe("The poker action to take"),
  amount: z
    .number()
    .nullable()
    .describe(
      "Total bet size in BB (big blinds). Required only for raise actions. Example: 3 means raise to 3BB total. Set to null for non-raise actions."
    ),
});

export class LlmGateway {
  private provider: LlmProvider;
  private google?: ReturnType<typeof createGoogleGenerativeAI>;
  private openrouter?: ReturnType<typeof createOpenRouter>;
  private lastCallTime = 0;
  private minDelayMs: number;
  private log: FastifyBaseLogger;

  constructor(opts: {
    provider?: LlmProvider;
    googleApiKey?: string;
    openrouterApiKey?: string;
    rateLimit?: number;
    log: FastifyBaseLogger;
  }) {
    this.provider = opts.provider ?? "gemini";
    this.log = opts.log;
    const rateLimit = opts.rateLimit ?? 10;
    this.minDelayMs = rateLimit > 0 ? Math.ceil(60_000 / rateLimit) : 0;

    if (this.provider === "openrouter") {
      if (!opts.openrouterApiKey)
        throw new Error("openrouterApiKey required for openrouter provider");
      this.openrouter = createOpenRouter({
        apiKey: opts.openrouterApiKey,
      });
    } else {
      if (!opts.googleApiKey) throw new Error("googleApiKey required for gemini provider");
      this.google = createGoogleGenerativeAI({
        apiKey: opts.googleApiKey,
      });
    }
  }

  private getModel(): LanguageModel {
    if (this.provider === "openrouter") {
      // return this.openrouter!.chat("meta-llama/llama-3.3-70b-instruct");
      return this.openrouter!.chat("openai/gpt-5-nano", {
        // reasoning: {
        //   enabled: true,
        //   exclude: false,
        //   effort: "medium",
        // },
      });
    }
    return this.google!("gemini-2.5-flash");
  }

  private async rateLimit(): Promise<void> {
    if (this.minDelayMs <= 0) return;
    const elapsed = Date.now() - this.lastCallTime;
    if (elapsed < this.minDelayMs) {
      await new Promise((r) => setTimeout(r, this.minDelayMs - elapsed));
    }
    this.lastCallTime = Date.now();
  }

  async getAction(
    template: number,
    gameState: GameStateSnapshot,
    playerIndex: number
  ): Promise<GameAction> {
    const tmpl = getTemplate(template);
    const player = gameState.players[playerIndex];
    if (!player) {
      return { type: "fold" };
    }

    const userMessage = this.buildUserMessage(gameState, playerIndex);
    this.log.info({ seat: playerIndex, template: tmpl.name }, "Requesting LLM action");
    this.log.debug({ prompt: userMessage }, "LLM prompt");

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.rateLimit();
        const result = await generateText({
          model: this.getModel(),
          system: tmpl.systemPrompt,
          prompt: userMessage,
          output: Output.object({
            schema: GameActionSchema,
          }),
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(30000),
        });

        console.log("llm result", result.content);
        console.log("llm result reasoning", result.reasoning, result.reasoningText);

        if (result.output) {
          const action: GameAction = {
            type: result.output.type,
            amount: result.output.amount ?? undefined,
          };

          // Capture LLM reasoning text
          const reasoning =
            (result as unknown as { reasoningText?: string }).reasoningText ||
            result.text ||
            undefined;
          if (reasoning) {
            action.reasoning = reasoning.length > 500 ? reasoning.slice(0, 500) + "…" : reasoning;
          }

          if (action.type === "raise" && action.amount != null) {
            const bb = gameState.bigBlind ?? 1;
            const lamports = Math.round(action.amount * bb);
            this.log.info(
              {
                seat: playerIndex,
                template: tmpl.name,
                action: "raise",
                bb: action.amount,
                lamports,
              },
              "LLM decided: raise"
            );
            action.amount = lamports;
          } else {
            this.log.info(
              {
                seat: playerIndex,
                template: tmpl.name,
                action: action.type,
                amount: action.amount,
              },
              "LLM decided"
            );
          }
          return action;
        }

        this.log.info(
          { seat: playerIndex, attempt: attempt + 1 },
          "LLM returned null output, retrying"
        );
      } catch (err) {
        this.log.error({ err, seat: playerIndex, attempt: attempt + 1 }, "LLM attempt error");
      }
    }

    const costToCall = Math.max(0, gameState.currentBet - (player.currentBet ?? 0));
    const fallback: GameAction = costToCall === 0 ? { type: "check" } : { type: "call" };
    this.log.info(
      { seat: playerIndex, fallback: fallback.type },
      "All LLM attempts failed, using fallback"
    );
    return fallback;
  }

  private cardName(index: number): string {
    const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
    const SUITS = ["h", "d", "c", "s"];
    return `${RANKS[index % 13]}${SUITS[Math.floor(index / 13)]}`;
  }

  private formatCards(cards: number[]): string {
    return cards.map((c) => this.cardName(c)).join(" ");
  }

  private toBB(lamports: number, bb: number): string {
    if (bb <= 0) return `${lamports}`;
    const bbs = lamports / bb;
    if (bbs === Math.floor(bbs)) return `${bbs}BB`;
    return `${bbs.toFixed(1)}BB`;
  }

  private buildUserMessage(gameState: GameStateSnapshot, playerIndex: number): string {
    const player = gameState.players[playerIndex];
    if (!player) {
      return "No player data available. Respond with fold.";
    }

    const bb = gameState.bigBlind ?? gameState.currentBet ?? 1;
    const costToCall = Math.max(0, gameState.currentBet - player.currentBet);
    const potAfterCall = gameState.pot + costToCall;
    const potOdds =
      costToCall > 0 ? `${(potAfterCall / costToCall).toFixed(1)}:1` : "free (you can check)";

    const startingStack = bb * 100;
    const playerCount = gameState.players.filter((p) => p.status !== "empty").length;
    const isHeadsUp = playerCount === 2;

    let handStrengthLine = "";
    if (player.holeCards) {
      const eval_ = evaluateHand(player.holeCards);
      handStrengthLine = `Hand Strength: ${eval_.tier} (top ${eval_.percentile}% of hands)`;
    }

    const lines: string[] = [
      `--- GAME STATE ---`,
      `Phase: ${gameState.phase}`,
      `Pot: ${this.toBB(gameState.pot, bb)}`,
      `Big Blind: ${this.toBB(bb, bb)}`,
    ];

    if (isHeadsUp) {
      lines.push(`This is HEADS-UP (1v1). Play wide ranges.`);
    } else {
      lines.push(`This is a ${playerCount}-player game. Tighten your ranges.`);
    }

    lines.push(
      ``,
      `--- YOUR HAND ---`,
      `Seat: ${playerIndex}`,
      `Hole Cards: ${player.holeCards ? this.formatCards(player.holeCards) : "UNKNOWN"}`
    );

    if (handStrengthLine) {
      lines.push(handStrengthLine);
    }

    lines.push(
      `Your Bet This Round: ${this.toBB(player.currentBet, bb)}`,
      `Cost to Call: ${this.toBB(costToCall, bb)}`,
      `Pot Odds: ${potOdds}`,
      `Estimated Stack: ${this.toBB(startingStack - player.currentBet, bb)}`,
      ``,
      `Community Cards: ${gameState.communityCards.length > 0 ? this.formatCards(gameState.communityCards) : "None (preflop)"}`,
      ``,
      `--- OPPONENTS ---`
    );

    for (const p of gameState.players) {
      if (p.seatIndex === playerIndex || p.status === "empty") continue;
      lines.push(
        `  Seat ${p.seatIndex}: ${p.displayName} [${p.status}] - Bet: ${this.toBB(p.currentBet, bb)}`
      );
    }

    if (gameState.lastAction) {
      const last = gameState.lastAction;
      const lastPlayer = gameState.players[last.playerIndex];
      lines.push(
        ``,
        `Last Action: ${lastPlayer?.displayName ?? `Seat ${last.playerIndex}`} ${last.action.type}${last.action.amount !== undefined ? ` ${this.toBB(last.action.amount, bb)}` : ""}`
      );
    }

    const actions: string[] = [];
    if (costToCall === 0) {
      actions.push("check", `raise (min ${this.toBB(bb * 2, bb)})`, "all_in", "fold");
    } else {
      actions.push(
        `call (${this.toBB(costToCall, bb)})`,
        `raise (min ${this.toBB(gameState.currentBet * 2, bb)})`,
        "all_in",
        "fold"
      );
    }

    lines.push(``, `Available: ${actions.join(" | ")}`);
    lines.push(``, `Your action?`);
    return lines.join("\n");
  }
}

declare module "fastify" {
  interface FastifyInstance {
    llm: LlmGateway;
  }
}

export default fp(
  async (fastify: FastifyInstance) => {
    const gateway = new LlmGateway({
      provider: fastify.env.LLM_PROVIDER,
      googleApiKey: fastify.env.GOOGLE_GENERATIVE_AI_API_KEY,
      openrouterApiKey: fastify.env.OPENROUTER_API_KEY,
      log: fastify.log,
    });
    fastify.decorate("llm", gateway);
    fastify.log.info("LLM plugin loaded");
  },
  { name: "llm", dependencies: ["env"] }
);
