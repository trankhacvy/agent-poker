import fp from "fastify-plugin";
import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import type { Matchmaker } from "./matchmaker.js";
import type { OnChainReader } from "./solana-read.js";
import type { WsFeed } from "./websocket-feed.js";

const AGENTS_PER_GAME = 2;
const LOWEST_WAGER_TIER = 0.1e9; // $1 tier — 0.1 SOL in lamports

export class AutoQueue {
  private matchmaker: Matchmaker;
  private reader: OnChainReader;
  private wsFeed: WsFeed;
  private intervalMs: number;
  private enabled: boolean;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastGameEndedAt: number | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private nextGameDelay = 30_000;
  private log: FastifyBaseLogger;

  constructor(
    matchmaker: Matchmaker,
    reader: OnChainReader,
    opts: {
      intervalMs: number;
      enabled: boolean;
      wsFeed: WsFeed;
      log: FastifyBaseLogger;
    }
  ) {
    this.matchmaker = matchmaker;
    this.reader = reader;
    this.wsFeed = opts.wsFeed;
    this.intervalMs = opts.intervalMs;
    this.enabled = opts.enabled;
    this.log = opts.log;
  }

  notifyGameEnded(): void {
    this.lastGameEndedAt = Date.now();
    this.clearCountdown();

    const totalSeconds = Math.ceil(this.nextGameDelay / 1000);
    let remaining = totalSeconds;

    // Broadcast immediately so the frontend gets the first tick
    this.wsFeed.broadcast({
      type: "next_game_countdown",
      data: { secondsRemaining: remaining },
      timestamp: Date.now(),
    });

    this.countdownTimer = setInterval(() => {
      remaining -= 1;
      this.wsFeed.broadcast({
        type: "next_game_countdown",
        data: { secondsRemaining: remaining },
        timestamp: Date.now(),
      });
      if (remaining <= 0) {
        this.clearCountdown();
      }
    }, 1000);
  }

  private clearCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  start(): void {
    if (!this.enabled) {
      this.log.info("AutoQueue disabled via config, not starting");
      return;
    }

    this.log.info(
      { intervalMs: this.intervalMs },
      "AutoQueue started"
    );

    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    this.clearCountdown();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.log.info("AutoQueue stopped");
    }
  }

  private async tick(): Promise<void> {
    try {
      const tables = this.matchmaker.getActiveTables();
      const hasActiveGame = tables.some(
        (t) => t.status === "in_progress" || t.status === "full"
      );

      if (hasActiveGame) {
        this.log.debug(
          "AutoQueue skipping — active game already running"
        );
        return;
      }

      if (this.lastGameEndedAt) {
        const elapsed = Date.now() - this.lastGameEndedAt;
        const remaining = this.nextGameDelay - elapsed;
        if (remaining > 0) {
          this.log.debug(
            { secondsRemaining: Math.ceil(remaining / 1000) },
            "AutoQueue waiting before next game"
          );
          return;
        }
        this.lastGameEndedAt = null;
        this.clearCountdown();
      }

      const { agents } = await this.reader.getAllAgents(0, 100);

      if (agents.length < AGENTS_PER_GAME) {
        this.log.debug(
          { agentCount: agents.length, needed: AGENTS_PER_GAME },
          "AutoQueue skipping — not enough agents"
        );
        return;
      }

      const shuffled = [...agents].sort(
        () => Math.random() - 0.5
      );
      const picked = shuffled.slice(0, AGENTS_PER_GAME);

      this.log.info(
        {
          agents: picked.map((a) => a.displayName),
        },
        "AutoQueue queuing agents"
      );

      for (const agent of picked) {
        this.matchmaker.joinQueue(
          {
            pubkey: agent.pubkey,
            displayName: agent.displayName,
            template: agent.template,
            seatIndex: 0,
          },
          LOWEST_WAGER_TIER
        );
      }
    } catch (err) {
      this.log.error(
        { err },
        "AutoQueue tick failed, will retry next interval"
      );
    }
  }
}

declare module "fastify" {
  interface FastifyInstance {
    autoQueue: AutoQueue;
  }
}

export default fp(
  async (fastify: FastifyInstance) => {
    const autoQueue = new AutoQueue(
      fastify.matchmaker,
      fastify.solanaRead,
      {
        intervalMs: fastify.env.AUTO_MATCH_INTERVAL_MS,
        enabled: fastify.env.AUTO_MATCH_ENABLED,
        wsFeed: fastify.wsFeed,
        log: fastify.log,
      }
    );
    fastify.decorate("autoQueue", autoQueue);
    autoQueue.start();
    fastify.addHook("onClose", () => autoQueue.stop());
    fastify.log.info("AutoQueue plugin loaded");
  },
  {
    name: "auto-queue",
    dependencies: [
      "env",
      "matchmaker",
      "solana-read",
      "websocket-feed",
    ],
  }
);
