import fp from "fastify-plugin";
import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { randomUUID } from "node:crypto";
import { ARENA_AGENTS, type ArenaAgentConfig } from "../lib/arena-agents.js";
import type { Orchestrator } from "./orchestrator.js";
import type { SolanaClient } from "./solana-write.js";
import type { WsFeed } from "./websocket-feed.js";
import type { GameTracker } from "./game-tracker.js";
import type { GameConfig, PlayerInfo, WsMessage } from "../types.js";

// ─── Constants ───────────────────────────────────────────────
const BETTING_WINDOW_SECONDS = 60;
const COOLDOWN_SECONDS = 30;
const MIN_BETTED_AGENTS = 2;
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
  agents: (ArenaAgentConfig & { virtualBalance: number })[];
  bettingSecondsRemaining: number | null;
  cooldownSecondsRemaining: number | null;
  requireBets: boolean;
}

export interface ArenaManagerConfig {
  /** When false, the game plays even with zero bets — gate check is skipped. */
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

  // Off-chain bet tracking — mirrors on-chain state for real-time WS updates.
  // The actual SOL lives on-chain in the BettingPool vault.
  private currentPool: {
    agents: Map<string, { total: number; bettors: Map<string, number> }>;
    totalPool: number;
  } | null = null;

  // Virtual balances for display
  private virtualBalances: Map<string, number> = new Map();

  constructor(
    private orchestrator: Orchestrator,
    private solanaClient: SolanaClient,
    private wsFeed: WsFeed,
    private gameTracker: GameTracker,
    private log: FastifyBaseLogger,
    private config: ArenaManagerConfig
  ) {
    for (const agent of ARENA_AGENTS) {
      this.virtualBalances.set(agent.pubkey, 100);
    }
  }

  // ── Public API ──────────────────────────────────────────
  getStatus(): ArenaStatus {
    return {
      state: this.state,
      roundNumber: this.roundNumber,
      currentTableId: this.currentTableId,
      currentGameId: this.currentGameId,
      agents: ARENA_AGENTS.map((a) => ({
        ...a,
        virtualBalance: this.virtualBalances.get(a.pubkey) ?? 100,
      })),
      bettingSecondsRemaining: this.bettingSecondsRemaining,
      cooldownSecondsRemaining: this.cooldownSecondsRemaining,
      requireBets: this.config.requireBets,
    };
  }

  getPool(): { totalPool: number; agentPools: Record<string, number> } {
    if (!this.currentPool) return { totalPool: 0, agentPools: {} };
    const agentPools: Record<string, number> = {};
    for (const [pubkey, data] of this.currentPool.agents) {
      agentPools[pubkey] = data.total;
    }
    return { totalPool: this.currentPool.totalPool, agentPools };
  }

  /**
   * Track a bet that was already placed on-chain by the user's wallet.
   * The frontend sends the on-chain `place_bet` tx (user signs), then calls
   * this method so the server can mirror the pool state for real-time WS updates.
   *
   * @param wallet   - bettor's public key
   * @param agentPubkey - which agent the bet is on
   * @param amount   - bet amount in lamports
   * @param txSignature - on-chain tx signature for verification
   */
  async placeBet(
    wallet: string,
    agentPubkey: string,
    amount: number,
    txSignature?: string
  ): Promise<boolean> {
    if (this.state !== "betting" || !this.currentPool || amount <= 0) {
      return false;
    }
    if (!ARENA_AGENTS.find((a) => a.pubkey === agentPubkey)) return false;

    // Verify the on-chain tx actually landed (if signature provided)
    if (txSignature) {
      try {
        const confirmed = await this.solanaClient.confirmTransaction(txSignature);
        if (!confirmed) {
          this.log.warn({ txSignature, wallet }, "On-chain bet tx not confirmed");
          return false;
        }
      } catch (err) {
        this.log.warn({ err, txSignature }, "Failed to verify bet tx");
        return false;
      }
    }

    // Track off-chain for real-time pool updates
    let agentPool = this.currentPool.agents.get(agentPubkey);
    if (!agentPool) {
      agentPool = { total: 0, bettors: new Map() };
      this.currentPool.agents.set(agentPubkey, agentPool);
    }
    const existing = agentPool.bettors.get(wallet) ?? 0;
    agentPool.bettors.set(wallet, existing + amount);
    agentPool.total += amount;
    this.currentPool.totalPool += amount;

    this.log.info(
      { wallet, agentPubkey, amount, txSignature },
      "Bet tracked (on-chain + off-chain)"
    );

    this.broadcastArena("arena_pool_update", this.getPool());
    return true;
  }

  async start(): Promise<void> {
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
    this.currentPool = { agents: new Map(), totalPool: 0 };
    this.poolCreatedOnChain = false;

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
    this.broadcastArena("arena_betting_open", {
      tableId,
      roundNumber: this.roundNumber,
      agents: this.getStatus().agents,
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
    const pool = this.getPool();
    const agentsWithBets = Object.values(pool.agentPools).filter(
      (v) => v > 0
    ).length;
    const hasBets = pool.totalPool > 0;

    if (this.config.requireBets && agentsWithBets < MIN_BETTED_AGENTS) {
      // Gate failed — refund all on-chain bets and restart
      this.log.info({ agentsWithBets }, "Betting gate failed");
      this.setState("refunding");

      this.broadcastArena("arena_gate_failed", {
        tableId,
        reason: `Only ${agentsWithBets} agent(s) received bets (need ${MIN_BETTED_AGENTS})`,
      });

      if (hasBets && this.poolCreatedOnChain) {
        await this.cancelAndRefundPool(tableId);
      } else if (this.poolCreatedOnChain) {
        // No bets placed, just cancel + close the empty pool
        await this.cancelAndCloseEmptyPool(tableId);
      }

      this.currentPool = null;
      this.currentTableId = null;
      // No cooldown on gate failure — restart immediately
      return;
    }

    // Gate passed (or requireBets=false)
    if (!this.config.requireBets && agentsWithBets < MIN_BETTED_AGENTS) {
      this.log.info(
        { agentsWithBets },
        "Betting gate skipped (ARENA_REQUIRE_BETS=false), playing anyway"
      );
    }

    // ── 4. Lock betting + play game ──
    this.setState("playing");
    if (hasBets && this.poolCreatedOnChain) {
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
      const { winnerIndex, pot } = gameResult;
      this.gameTracker.decrement();

      this.updateVirtualBalances(winnerIndex);

      // Settle on-chain betting pool (only if bets exist)
      if (hasBets && this.poolCreatedOnChain) {
        try {
          await this.solanaClient.settleBettingPool(tableId, winnerIndex);
          this.log.info({ tableId, winnerIndex }, "On-chain betting pool settled");
        } catch (err) {
          this.log.warn({ err }, "Failed to settle betting pool on-chain");
        }
      } else if (this.poolCreatedOnChain) {
        // No bets — cancel + close the empty pool to reclaim rent
        await this.cancelAndCloseEmptyPool(tableId);
      }

      const winner = ARENA_AGENTS[winnerIndex];
      this.broadcastArena("arena_game_complete", {
        tableId,
        gameId,
        winnerIndex,
        winnerName: winner?.displayName,
        pot,
        virtualBalances: Object.fromEntries(this.virtualBalances),
      });
    } else {
      // All attempts failed
      this.gameTracker.decrement();
      this.log.error({ err: lastErr, tableId, attempts: attempt }, "Arena game failed after retries");
      this.broadcastArena("arena_game_failed", { tableId });
      // Refund on-chain bets on game failure
      if (hasBets && this.poolCreatedOnChain) {
        await this.cancelAndRefundPool(tableId);
      } else if (this.poolCreatedOnChain) {
        await this.cancelAndCloseEmptyPool(tableId);
      }
    }

    this.currentGameId = null;
    this.currentPool = null;

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
    this.broadcastArena("arena_state_change", { state });
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

  /**
   * Cancel pool on-chain, refund each bettor's on-chain BetAccount,
   * then close the pool account to reclaim rent.
   */
  private async cancelAndRefundPool(tableId: string): Promise<void> {
    try {
      await this.solanaClient.cancelBettingPool(tableId);
      this.log.info({ tableId }, "On-chain pool cancelled");

      // Refund each bettor
      if (this.currentPool) {
        for (const [, agentPool] of this.currentPool.agents) {
          for (const [wallet] of agentPool.bettors) {
            try {
              await this.solanaClient.refundBet(tableId, wallet);
              this.log.info({ tableId, wallet }, "On-chain bet refunded");
            } catch (err) {
              this.log.error({ err, wallet, tableId }, "Failed to refund bet on-chain");
            }
          }
        }
      }

      // Close pool to reclaim rent
      await this.solanaClient.closeBettingPool(tableId);
      this.log.info({ tableId }, "On-chain pool closed");
    } catch (err) {
      this.log.error({ err, tableId }, "Failed to cancel/refund pool on-chain");
    }
  }

  /** Cancel + close a pool that has zero bets (no refunds needed). */
  private async cancelAndCloseEmptyPool(tableId: string): Promise<void> {
    try {
      await this.solanaClient.cancelBettingPool(tableId);
      await this.solanaClient.closeBettingPool(tableId);
      this.log.info({ tableId }, "Empty on-chain pool cancelled + closed");
    } catch (err) {
      this.log.error({ err, tableId }, "Failed to cancel/close empty pool");
    }
  }

  private updateVirtualBalances(winnerIndex: number): void {
    const winner = ARENA_AGENTS[winnerIndex];
    if (!winner) return;
    for (const agent of ARENA_AGENTS) {
      const current = this.virtualBalances.get(agent.pubkey) ?? 100;
      if (agent.pubkey === winner.pubkey) {
        this.virtualBalances.set(agent.pubkey, current + 10);
      } else {
        this.virtualBalances.set(agent.pubkey, Math.max(50, current - 2));
      }
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
