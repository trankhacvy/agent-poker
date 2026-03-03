import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { PlayerInfo, TableInfo, BettingWindowData, QueueTimeoutData } from "./types.js";
import type { WsFeed } from "./ws-feed.js";

const MAX_PLAYERS = 2; // TODO: revert to 6 for production
const BETTING_WINDOW_SECONDS = 10;
const BETTING_COUNTDOWN_INTERVAL_SECONDS = 10;
const QUEUE_TIMEOUT_MS = 5 * 60 * 1000;
const QUEUE_CLEANUP_INTERVAL_MS = 30 * 1000;

interface QueueEntry {
  players: PlayerInfo[];
  createdAt: number;
}

interface BettingWindow {
  tableId: string;
  wagerTier: number;
  players: PlayerInfo[];
  startedAt: number;
  countdownTimer: ReturnType<typeof setInterval>;
  completionTimer: ReturnType<typeof setTimeout>;
  active: boolean;
}

interface MatchmakerEvents {
  tableFull: [config: { tableId: string; wagerTier: number; players: PlayerInfo[] }];
  bettingLocked: [config: { tableId: string; wagerTier: number; players: PlayerInfo[] }];
  queueTimeout: [config: { wagerTier: number; refundedPlayers: PlayerInfo[] }];
}

export class Matchmaker extends EventEmitter<MatchmakerEvents> {
  private queues: Map<number, QueueEntry> = new Map();
  private tables: Map<string, TableInfo> = new Map();
  private bettingWindows: Map<string, BettingWindow> = new Map();
  private betPools: Map<string, Map<string, { total: number; bettors: Map<string, number> }>> = new Map();
  private wsFeed: WsFeed;
  private queueCleanupTimer: ReturnType<typeof setInterval>;

  constructor(wsFeed: WsFeed) {
    super();
    this.wsFeed = wsFeed;
    this.queueCleanupTimer = setInterval(
      () => this.cleanupStaleQueues(),
      QUEUE_CLEANUP_INTERVAL_MS
    );
  }

  joinQueue(playerInfo: PlayerInfo, wagerTier: number): void {
    let entry = this.queues.get(wagerTier);
    if (!entry) {
      entry = { players: [], createdAt: Date.now() };
      this.queues.set(wagerTier, entry);
    }

    entry.players.push(playerInfo);

    if (entry.players.length >= MAX_PLAYERS) {
      const players = entry.players.splice(0, MAX_PLAYERS).map((p, i) => ({
        ...p,
        seatIndex: i,
      }));
      const tableId = randomUUID();

      if (entry.players.length === 0) {
        this.queues.delete(wagerTier);
      }

      const tableInfo: TableInfo = {
        tableId,
        wagerTier,
        playerCount: players.length,
        maxPlayers: MAX_PLAYERS,
        status: "full",
        players,
      };
      this.tables.set(tableId, tableInfo);

      this.emit("tableFull", { tableId, wagerTier, players });
      this.startBettingWindow(tableId, wagerTier, players);
    }
  }

  placeBet(tableId: string, wallet: string, agentPubkey: string, amount: number): boolean {
    if (amount <= 0) return false;
    if (!this.isBettingWindowActive(tableId)) return false;

    let tablePool = this.betPools.get(tableId);
    if (!tablePool) {
      tablePool = new Map();
      this.betPools.set(tableId, tablePool);
    }

    let agentPool = tablePool.get(agentPubkey);
    if (!agentPool) {
      agentPool = { total: 0, bettors: new Map() };
      tablePool.set(agentPubkey, agentPool);
    }

    const existing = agentPool.bettors.get(wallet) ?? 0;
    agentPool.bettors.set(wallet, existing + amount);
    agentPool.total += amount;

    const poolData = this.getPool(tableId);
    this.wsFeed.broadcast({
      type: "pool_update",
      data: poolData,
      tableId,
      timestamp: Date.now(),
    });

    return true;
  }

  getPool(tableId: string): { totalPool: number; agentPools: Record<string, number> } {
    const tablePool = this.betPools.get(tableId);
    if (!tablePool) return { totalPool: 0, agentPools: {} };

    let totalPool = 0;
    const agentPools: Record<string, number> = {};
    for (const [agentPubkey, pool] of tablePool) {
      agentPools[agentPubkey] = pool.total;
      totalPool += pool.total;
    }
    return { totalPool, agentPools };
  }

  getBettingWindowRemaining(tableId: string): number {
    const window = this.bettingWindows.get(tableId);
    if (!window || !window.active) {
      return 0;
    }
    const elapsed = (Date.now() - window.startedAt) / 1000;
    return Math.max(0, Math.ceil(BETTING_WINDOW_SECONDS - elapsed));
  }

  isBettingWindowActive(tableId: string): boolean {
    const window = this.bettingWindows.get(tableId);
    return window !== undefined && window.active;
  }

  getQueueSize(wagerTier: number): number {
    return this.queues.get(wagerTier)?.players.length ?? 0;
  }

  getActiveTables(): TableInfo[] {
    return Array.from(this.tables.values());
  }

  getTable(tableId: string): TableInfo | undefined {
    return this.tables.get(tableId);
  }

  updateTableStatus(tableId: string, status: TableInfo["status"]): void {
    const table = this.tables.get(tableId);
    if (table) {
      table.status = status;
    }
  }

  destroy(): void {
    clearInterval(this.queueCleanupTimer);
    for (const window of this.bettingWindows.values()) {
      clearInterval(window.countdownTimer);
      clearTimeout(window.completionTimer);
    }
    this.bettingWindows.clear();
  }

  private startBettingWindow(
    tableId: string,
    wagerTier: number,
    players: PlayerInfo[]
  ): void {
    const startedAt = Date.now();

    const countdownTimer = setInterval(() => {
      const remaining = this.getBettingWindowRemaining(tableId);
      if (remaining <= 0) {
        return;
      }
      const data: BettingWindowData = {
        tableId,
        secondsRemaining: remaining,
        wagerTier,
        players,
      };
      this.wsFeed.broadcast({
        type: "betting_countdown",
        data,
        tableId,
        timestamp: Date.now(),
      });
    }, BETTING_COUNTDOWN_INTERVAL_SECONDS * 1000);

    const completionTimer = setTimeout(() => {
      this.completeBettingWindow(tableId);
    }, BETTING_WINDOW_SECONDS * 1000);

    const window: BettingWindow = {
      tableId,
      wagerTier,
      players,
      startedAt,
      countdownTimer,
      completionTimer,
      active: true,
    };
    this.bettingWindows.set(tableId, window);

    const initialData: BettingWindowData = {
      tableId,
      secondsRemaining: BETTING_WINDOW_SECONDS,
      wagerTier,
      players,
    };
    this.wsFeed.broadcast({
      type: "betting_countdown",
      data: initialData,
      tableId,
      timestamp: Date.now(),
    });
  }

  private completeBettingWindow(tableId: string): void {
    const window = this.bettingWindows.get(tableId);
    if (!window || !window.active) {
      return;
    }

    window.active = false;
    clearInterval(window.countdownTimer);

    const lockedData: BettingWindowData = {
      tableId,
      secondsRemaining: 0,
      wagerTier: window.wagerTier,
      players: window.players,
    };
    this.wsFeed.broadcast({
      type: "betting_locked",
      data: lockedData,
      tableId,
      timestamp: Date.now(),
    });

    this.emit("bettingLocked", {
      tableId,
      wagerTier: window.wagerTier,
      players: window.players,
    });

    this.bettingWindows.delete(tableId);
  }

  private cleanupStaleQueues(): void {
    const now = Date.now();

    for (const [wagerTier, entry] of this.queues) {
      if (now - entry.createdAt >= QUEUE_TIMEOUT_MS && entry.players.length > 0) {
        const refundedPlayers = [...entry.players];
        this.queues.delete(wagerTier);

        const data: QueueTimeoutData = {
          wagerTier,
          refundedPlayers,
        };
        this.wsFeed.broadcast({
          type: "queue_timeout",
          data,
          timestamp: Date.now(),
        });

        this.emit("queueTimeout", { wagerTier, refundedPlayers });
      }
    }
  }
}
