import { generateText, Output, type LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import type { GameAction, GameStateSnapshot } from "./types.js";
import { getTemplate } from "./templates.js";

export type LlmProvider = "gemini" | "openrouter";

const GameActionSchema = z.object({
  type: z
    .enum(["fold", "check", "call", "raise", "all_in"])
    .describe("The poker action to take"),
  amount: z
    .number()
    .optional()
    .describe("Total bet size in BB (big blinds). Required only for raise actions. Example: 3 means raise to 3BB total."),
});

function evaluateHand(cards: [number, number]): { tier: string; percentile: number } {
  const rank1 = cards[0] % 13;
  const rank2 = cards[1] % 13;
  const suit1 = Math.floor(cards[0] / 13);
  const suit2 = Math.floor(cards[1] / 13);
  const suited = suit1 === suit2;
  const highRank = Math.max(rank1, rank2);
  const lowRank = Math.min(rank1, rank2);
  const gap = highRank - lowRank;
  const pair = rank1 === rank2;

  if (pair) {
    if (highRank >= 12) return { tier: "Premium", percentile: 1 };
    if (highRank >= 10) return { tier: "Premium", percentile: 3 };
    if (highRank >= 8) return { tier: "Strong", percentile: 6 };
    if (highRank >= 6) return { tier: "Good", percentile: 12 };
    if (highRank >= 4) return { tier: "Good", percentile: 18 };
    return { tier: "Playable", percentile: 30 };
  }

  if (highRank === 12) {
    if (lowRank >= 10) return { tier: suited ? "Premium" : "Strong", percentile: suited ? 4 : 7 };
    if (lowRank >= 8) return { tier: suited ? "Strong" : "Good", percentile: suited ? 8 : 14 };
    if (suited) return { tier: "Good", percentile: 20 };
    if (lowRank >= 7) return { tier: "Playable", percentile: 25 };
    return { tier: "Playable", percentile: 35 };
  }

  if (highRank === 11) {
    if (lowRank >= 10 && suited) return { tier: "Strong", percentile: 8 };
    if (lowRank >= 9) return { tier: "Good", percentile: suited ? 12 : 18 };
    if (suited) return { tier: "Playable", percentile: 25 };
    return { tier: "Playable", percentile: 35 };
  }

  if (suited) {
    if (gap === 1 && lowRank >= 4) return { tier: "Good", percentile: 20 };
    if (gap === 1) return { tier: "Playable", percentile: 35 };
    if (gap === 2 && lowRank >= 4) return { tier: "Playable", percentile: 30 };
    if (highRank >= 9) return { tier: "Playable", percentile: 30 };
    return { tier: "Weak", percentile: 55 };
  }

  if (lowRank >= 9) return { tier: "Good", percentile: 18 };

  if (gap === 1 && lowRank >= 6) return { tier: "Playable", percentile: 35 };
  if (gap === 1 && lowRank >= 3) return { tier: "Playable", percentile: 45 };

  if (highRank >= 9 && lowRank >= 6) return { tier: "Playable", percentile: 40 };

  return { tier: "Weak", percentile: 60 };
}

export class LlmGateway {
  private provider: LlmProvider;
  private google?: ReturnType<typeof createGoogleGenerativeAI>;
  private openrouter?: ReturnType<typeof createOpenRouter>;
  private lastCallTime = 0;
  private minDelayMs: number;

  constructor(opts: {
    provider?: LlmProvider;
    googleApiKey?: string;
    openrouterApiKey?: string;
    rateLimit?: number;
  }) {
    this.provider = opts.provider ?? "gemini";
    const rateLimit = opts.rateLimit ?? 10;
    this.minDelayMs = rateLimit > 0 ? Math.ceil(60_000 / rateLimit) : 0;

    if (this.provider === "openrouter") {
      if (!opts.openrouterApiKey) throw new Error("openrouterApiKey required for openrouter provider");
      this.openrouter = createOpenRouter({ apiKey: opts.openrouterApiKey });
    } else {
      if (!opts.googleApiKey) throw new Error("googleApiKey required for gemini provider");
      this.google = createGoogleGenerativeAI({ apiKey: opts.googleApiKey });
    }
  }

  private getModel(): LanguageModel {
    if (this.provider === "openrouter") {
      return this.openrouter!.chat("google/gemini-2.5-flash");
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
    console.log(`[LLM] Prompt for seat ${playerIndex} (${tmpl.name}):\n${userMessage}`);

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
          abortSignal: AbortSignal.timeout(20000),
        });

        if (result.output) {
          const action = { ...result.output };
          if (action.type === "raise" && action.amount != null) {
            const bb = gameState.bigBlind ?? 1;
            const lamports = Math.round(action.amount * bb);
            console.log(`[LLM] Seat ${playerIndex} (${tmpl.name}) decided: raise ${action.amount}BB → ${lamports} lamports`);
            action.amount = lamports;
          } else {
            console.log(`[LLM] Seat ${playerIndex} (${tmpl.name}) decided: ${action.type}${action.amount ? ` ${action.amount}` : ""}`);
          }
          return action;
        }

        console.log(`[LLM] Seat ${playerIndex} attempt ${attempt + 1}: null output, retrying...`);
      } catch (err) {
        console.log(`[LLM] Seat ${playerIndex} attempt ${attempt + 1} error: ${err instanceof Error ? err.message : err}`);
      }
    }

    const costToCall = Math.max(0, gameState.currentBet - (player.currentBet ?? 0));
    const fallback: GameAction = costToCall === 0 ? { type: "check" } : { type: "call" };
    console.log(`[LLM] Seat ${playerIndex}: all attempts failed, falling back to ${fallback.type}`);
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

  private buildUserMessage(
    gameState: GameStateSnapshot,
    playerIndex: number
  ): string {
    const player = gameState.players[playerIndex];
    if (!player) {
      return "No player data available. Respond with fold.";
    }

    const bb = gameState.bigBlind ?? gameState.currentBet ?? 1;
    const costToCall = Math.max(0, gameState.currentBet - player.currentBet);
    const potAfterCall = gameState.pot + costToCall;
    const potOdds =
      costToCall > 0
        ? `${(potAfterCall / costToCall).toFixed(1)}:1`
        : "free (you can check)";

    const startingStack = bb * 100;

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
      `This is HEADS-UP (1v1). Play wide ranges.`,
      ``,
      `--- YOUR HAND ---`,
      `Seat: ${playerIndex}`,
      `Hole Cards: ${player.holeCards ? this.formatCards(player.holeCards) : "UNKNOWN"}`,
    ];

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
