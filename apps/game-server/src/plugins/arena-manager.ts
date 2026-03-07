import fp from "fastify-plugin";
import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { randomUUID } from "node:crypto";
import { ARENA_AGENTS, type ArenaAgentConfig } from "../lib/arena-agents.js";
import { loadState, saveState } from "../lib/arena-persistence.js";
import type { Orchestrator } from "./orchestrator.js";
import type { SolanaClient } from "./solana-write.js";
import type { WsFeed } from "./websocket-feed.js";
import type { GameTracker } from "./game-tracker.js";
import type { GameConfig, PlayerInfo, WsMessage } from "../types.js";

// ─── Constants ───────────────────────────────────────────────
const BETTING_WINDOW_SECONDS = 60;
const COOLDOWN_SECONDS = 30;
const ARENA_WAGER_TIER = 0.1e9; // 0.1 SOL for blind calculation

// ─── Types ───────────────────────────────────────────────────
export type ArenaState =
  | "idle"
  | "betting"
  | "playing"
  | "cooldown"
  | "refunding";

export interface ArenaStatus {
  state: ArenaState;
  roundNumber: number;
  currentTableId: string | null;
  currentGameId: string | null;
  agents: ArenaAgentConfig[];
  bettingSecondsRemaining: number | null;
  cooldownSecondsRemaining: number | null;
  requireBets: boolean;
}

export interface ArenaManagerConfig {
  requireBets: boolean;
}

// ─── ArenaManager Class ─────────────────────────────────────
export class ArenaManager {
  private state: ArenaState = "idle";
  private running = false;
  private roundNumber = 0;
  private currentTableId: string | null = null;
  private currentGameId: string | null = null;
  private bettingSecondsRemaining: number | null = null;
  private cooldownSecondsRemaining: number | null = null;
  private poolCreatedOnChain = false;

  constructor(
    private orchestrator: Orchestrator,
    private solanaClient: SolanaClient,
    private wsFeed: WsFeed,
    private gameTracker: GameTracker,
    private log: FastifyBaseLogger,
    private config: ArenaManagerConfig
  ) {}

  // ── Public API ──────────────────────────────────────────
  getStatus(): ArenaStatus {
    return {
      state: this.state,
      roundNumber: this.roundNumber,
      currentTableId: this.currentTableId,
      currentGameId: this.currentGameId,
      agents: ARENA_AGENTS.map((a) => ({ ...a })),
      bettingSecondsRemaining: this.bettingSecondsRemaining,
      cooldownSecondsRemaining: this.cooldownSecondsRemaining,
      requireBets: this.config.requireBets,
    };
  }

  async start(): Promise<void> {
    // 1. Restore round number from persistence
    const persisted = loadState();
    if (persisted) {
      this.roundNumber = persisted.roundNumber;
      this.log.info({ roundNumber: this.roundNumber }, "Restored arena state from disk");
    }

    // 2. Ensure arena agents exist on-chain
    await this.ensureArenaAgentsExist();

    // 3. Clean up orphaned pool from previous session
    if (persisted?.activeTableId) {
      this.log.info({ tableId: persisted.activeTableId }, "Cleaning up orphaned pool");
      await this.cancelAndCloseEmptyPool(persisted.activeTableId);
      saveState({ roundNumber: this.roundNumber, activeTableId: null });
    }

    // 4. Start
    this.running = true;
    this.log.info(
      { requireBets: this.config.requireBets },
      "ArenaManager started"
    );
    this.loop().catch((err) =>
      this.log.error({ err }, "Arena loop crashed")
    );
  }

  stop(): void {
    this.running = false;
    this.log.info("ArenaManager stopped");
  }

  // ── Main Loop ───────────────────────────────────────────
  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.runRound();
      } catch (err) {
        this.log.error({ err }, "Arena round failed, restarting");
        this.broadcastArena("arena_error", { message: "Round failed" });
        await this.sleep(10_000);
      }
    }
  }

  private async runRound(): Promise<void> {
    this.roundNumber++;
    const tableId = randomUUID();
    this.currentTableId = tableId;
    this.poolCreatedOnChain = false;

    saveState({ roundNumber: this.roundNumber, activeTableId: tableId });
    this.log.info({ round: this.roundNumber, tableId }, "Arena round starting");

    // ── 1. Create on-chain betting pool ──
    const agentPubkeys = ARENA_AGENTS.map((a) => a.pubkey);
    try {
      await this.solanaClient.createBettingPool(tableId, agentPubkeys);
      this.poolCreatedOnChain = true;
      this.log.info({ tableId }, "On-chain betting pool created");
    } catch (err) {
      this.log.warn({ err }, "Failed to create betting pool on-chain");
    }

    // ── 2. Betting window ──
    this.setState("betting");
    this.broadcastArena("arena_round_start", {
      tableId,
      roundNumber: this.roundNumber,
      agents: ARENA_AGENTS.map((a) => ({ ...a })),
      secondsRemaining: BETTING_WINDOW_SECONDS,
    });

    await this.countdown(BETTING_WINDOW_SECONDS, (remaining) => {
      this.bettingSecondsRemaining = remaining;
      this.broadcastArena("arena_betting_countdown", {
        tableId,
        secondsRemaining: remaining,
      });
    });
    this.bettingSecondsRemaining = null;

    // ── 3. Gate check ──
    // With chain-first architecture, we no longer track bets off-chain.
    // If requireBets is true, we skip the gate (the pool subscription on frontend handles display).
    // For simplicity, we always proceed to play — the pool is already on-chain.

    // ── 4. Lock betting + play game ──
    this.setState("playing");
    if (this.poolCreatedOnChain) {
      try {
        await this.solanaClient.lockBettingPool(tableId);
        this.log.info({ tableId }, "On-chain betting pool locked");
      } catch (err) {
        this.log.warn({ err }, "Failed to lock betting pool on-chain");
      }
    }
    this.broadcastArena("arena_betting_locked", { tableId });

    const gameId = Date.now().toString();
    this.currentGameId = gameId;

    const players: PlayerInfo[] = ARENA_AGENTS.map((a, i) => ({
      pubkey: a.pubkey,
      displayName: a.displayName,
      template: a.template,
      seatIndex: i,
    }));

    const gameConfig: GameConfig = {
      gameId,
      tableId,
      wagerTier: ARENA_WAGER_TIER,
      players,
    };

    this.gameTracker.increment();

    // Retry game up to 2 times if ER cloner/delegation issues occur
    let attempt = 0;
    const MAX_GAME_ATTEMPTS = 2;
    let gameResult: { winnerIndex: number; pot: number } | null = null;
    let lastErr: unknown = null;

    while (attempt < MAX_GAME_ATTEMPTS && !gameResult) {
      attempt++;
      try {
        gameResult = await this.orchestrator.runGame({
          ...gameConfig,
          gameId: attempt === 1 ? gameConfig.gameId : Date.now().toString(),
        });
      } catch (err) {
        lastErr = err;
        const errMsg = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_GAME_ATTEMPTS && errMsg.includes("Cloner error")) {
          this.log.warn(
            { attempt, tableId },
            "ER cloner error, waiting 15s before retry"
          );
          await this.sleep(15_000);
        }
      }
    }

    if (gameResult) {
      let { winnerIndex, pot } = gameResult;

      // DEV: override winner for testing bet/payout flow
      const forcedWinner = process.env.FORCE_WINNER_INDEX;
      if (forcedWinner != null && forcedWinner !== "") {
        const forced = parseInt(forcedWinner, 10);
        if (forced >= 0 && forced < ARENA_AGENTS.length) {
          this.log.warn({ original: winnerIndex, forced }, "FORCE_WINNER_INDEX override active");
          winnerIndex = forced;
        }
      }
      this.gameTracker.decrement();

      // Update on-chain agent stats for all 6 players
      await this.updateAgentStats(winnerIndex, pot);

      // Settle on-chain betting pool
      if (this.poolCreatedOnChain) {
        try {
          await this.solanaClient.settleBettingPool(tableId, winnerIndex);
          this.log.info({ tableId, winnerIndex }, "On-chain betting pool settled");
        } catch (err) {
          this.log.warn({ err }, "Failed to settle betting pool on-chain");
          // If settle fails, try to cancel + close
          await this.cancelAndCloseEmptyPool(tableId);
        }
      }

      const winner = ARENA_AGENTS[winnerIndex];
      this.broadcastArena("arena_game_end", {
        tableId,
        gameId,
        winnerIndex,
        winnerName: winner?.displayName,
        pot,
      });
    } else {
      // All attempts failed
      this.gameTracker.decrement();
      this.log.error({ err: lastErr, tableId, attempts: attempt }, "Arena game failed after retries");
      this.broadcastArena("arena_game_failed", { tableId });

      if (this.poolCreatedOnChain) {
        await this.cancelAndCloseEmptyPool(tableId);
      }
    }

    this.currentGameId = null;
    saveState({ roundNumber: this.roundNumber, activeTableId: null });

    // ── 5. Cooldown ──
    this.setState("cooldown");
    await this.countdown(COOLDOWN_SECONDS, (remaining) => {
      this.cooldownSecondsRemaining = remaining;
      this.broadcastArena("arena_cooldown", {
        secondsRemaining: remaining,
      });
    });
    this.cooldownSecondsRemaining = null;
    this.currentTableId = null;
  }

  // ── Helpers ─────────────────────────────────────────────
  private setState(state: ArenaState): void {
    this.state = state;
  }

  private broadcastArena(type: string, data: Record<string, unknown>): void {
    this.wsFeed.broadcastToChannel("arena", {
      type: type as WsMessage["type"],
      data: data as WsMessage["data"],
      tableId: this.currentTableId ?? undefined,
      gameId: this.currentGameId ?? undefined,
      timestamp: Date.now(),
    });
  }

  private async ensureArenaAgentsExist(): Promise<void> {
    for (const agent of ARENA_AGENTS) {
      try {
        const exists = await this.solanaClient.agentAccountExists(agent.pubkey);
        if (!exists) {
          this.log.info({ agent: agent.displayName, pubkey: agent.pubkey }, "Creating arena agent on-chain");
          // On-chain program supports templates 0-3, clamp higher values
          const onChainTemplate = Math.min(agent.template, 3);
          await this.solanaClient.createArenaAgent(
            agent.pubkey,
            onChainTemplate,
            agent.displayName
          );
          this.log.info({ agent: agent.displayName }, "Created arena agent on-chain");
        } else {
          this.log.info({ agent: agent.displayName }, "Arena agent already exists on-chain");
        }
      } catch (err) {
        this.log.warn({ err: err instanceof Error ? err.message : String(err), agent: agent.displayName }, "Failed to create arena agent");
      }
    }
  }

  private async updateAgentStats(winnerIndex: number, pot: number): Promise<void> {
    for (let i = 0; i < ARENA_AGENTS.length; i++) {
      const agent = ARENA_AGENTS[i]!;
      const isWinner = i === winnerIndex;
      try {
        await this.solanaClient.updateAgentStats(
          agent.pubkey,
          1, // gamesDelta
          isWinner ? 1 : 0, // winsDelta
          isWinner ? Math.floor(pot * 0.95) : 0 // earningsDelta
        );
      } catch (err) {
        this.log.warn({ err, agent: agent.displayName }, "Failed to update agent stats");
      }
    }
  }

  private async cancelAndCloseEmptyPool(tableId: string): Promise<void> {
    try {
      await this.solanaClient.cancelBettingPool(tableId);
      await this.solanaClient.closeBettingPool(tableId);
      this.log.info({ tableId }, "On-chain pool cancelled + closed");
    } catch (err) {
      this.log.debug({ err, tableId }, "Failed to cancel/close pool (may already be gone)");
    }
  }

  private async countdown(
    seconds: number,
    onTick: (remaining: number) => void
  ): Promise<void> {
    for (let remaining = seconds; remaining > 0; remaining--) {
      if (!this.running) break;
      onTick(remaining);
      await this.sleep(1000);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── Fastify Plugin ─────────────────────────────────────────
declare module "fastify" {
  interface FastifyInstance {
    arenaManager: ArenaManager;
  }
}

export default fp(
  async (fastify: FastifyInstance) => {
    const arenaManager = new ArenaManager(
      fastify.orchestrator,
      fastify.solanaWrite,
      fastify.wsFeed,
      fastify.gameTracker,
      fastify.log,
      { requireBets: fastify.env.ARENA_REQUIRE_BETS }
    );
    fastify.decorate("arenaManager", arenaManager);

    if (fastify.env.ARENA_MODE_ENABLED) {
      arenaManager.start();
    }

    fastify.addHook("onClose", () => arenaManager.stop());
    fastify.log.info(
      { requireBets: fastify.env.ARENA_REQUIRE_BETS },
      "ArenaManager plugin loaded"
    );
  },
  {
    name: "arena-manager",
    dependencies: [
      "env",
      "orchestrator",
      "solana-write",
      "websocket-feed",
      "game-tracker",
    ],
  }
);
