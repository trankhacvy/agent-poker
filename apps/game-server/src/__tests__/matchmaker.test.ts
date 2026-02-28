import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PlayerInfo, WsMessage } from "../types.js";

function makePlayer(index: number): PlayerInfo {
  return {
    pubkey: `pubkey_${index}`,
    displayName: `Player ${index}`,
    template: index % 4,
    seatIndex: index,
  };
}

class MockWsFeed {
  messages: WsMessage[] = [];
  broadcast(msg: WsMessage): void {
    this.messages.push(msg);
  }
  broadcastToGame(_gameId: string, msg: WsMessage): void {
    this.messages.push(msg);
  }
}

describe("Matchmaker - queue system", () => {
  let mockWsFeed: MockWsFeed;
  let Matchmaker: typeof import("../matchmaker.js").Matchmaker;

  beforeEach(async () => {
    vi.useFakeTimers();
    const mod = await import("../matchmaker.js");
    Matchmaker = mod.Matchmaker;
    mockWsFeed = new MockWsFeed();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks queue size correctly", () => {
    const mm = new Matchmaker(mockWsFeed as never);
    mm.joinQueue(makePlayer(0), 1000);
    mm.joinQueue(makePlayer(1), 1000);
    expect(mm.getQueueSize(1000)).toBe(2);
    mm.destroy();
  });

  it("returns 0 for empty queue", () => {
    const mm = new Matchmaker(mockWsFeed as never);
    expect(mm.getQueueSize(5000)).toBe(0);
    mm.destroy();
  });

  it("creates table when 6 players join", () => {
    const mm = new Matchmaker(mockWsFeed as never);
    const events: { tableId: string; wagerTier: number; players: PlayerInfo[] }[] = [];
    mm.on("tableFull", (config) => events.push(config));

    for (let i = 0; i < 6; i++) {
      mm.joinQueue(makePlayer(i), 1000);
    }

    expect(events).toHaveLength(1);
    expect(events[0].wagerTier).toBe(1000);
    expect(events[0].players).toHaveLength(6);
    expect(mm.getQueueSize(1000)).toBe(0);
    mm.destroy();
  });

  it("assigns seat indices 0-5", () => {
    const mm = new Matchmaker(mockWsFeed as never);
    const events: { players: PlayerInfo[] }[] = [];
    mm.on("tableFull", (config) => events.push(config));

    for (let i = 0; i < 6; i++) {
      mm.joinQueue(makePlayer(i), 1000);
    }

    const seats = events[0].players.map((p) => p.seatIndex);
    expect(seats).toEqual([0, 1, 2, 3, 4, 5]);
    mm.destroy();
  });

  it("separate queues per wager tier", () => {
    const mm = new Matchmaker(mockWsFeed as never);
    mm.joinQueue(makePlayer(0), 1000);
    mm.joinQueue(makePlayer(1), 5000);

    expect(mm.getQueueSize(1000)).toBe(1);
    expect(mm.getQueueSize(5000)).toBe(1);
    mm.destroy();
  });

  it("tracks active tables", () => {
    const mm = new Matchmaker(mockWsFeed as never);
    for (let i = 0; i < 6; i++) {
      mm.joinQueue(makePlayer(i), 1000);
    }

    const tables = mm.getActiveTables();
    expect(tables).toHaveLength(1);
    expect(tables[0].status).toBe("full");
    expect(tables[0].playerCount).toBe(6);
    mm.destroy();
  });

  it("updates table status", () => {
    const mm = new Matchmaker(mockWsFeed as never);
    mm.on("tableFull", ({ tableId }) => {
      mm.updateTableStatus(tableId, "in_progress");
    });

    for (let i = 0; i < 6; i++) {
      mm.joinQueue(makePlayer(i), 1000);
    }

    const tables = mm.getActiveTables();
    expect(tables[0].status).toBe("in_progress");
    mm.destroy();
  });
});

describe("Matchmaker - betting window", () => {
  let mockWsFeed: MockWsFeed;
  let Matchmaker: typeof import("../matchmaker.js").Matchmaker;

  beforeEach(async () => {
    vi.useFakeTimers();
    const mod = await import("../matchmaker.js");
    Matchmaker = mod.Matchmaker;
    mockWsFeed = new MockWsFeed();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts betting window when table fills", () => {
    const mm = new Matchmaker(mockWsFeed as never);
    let tableId = "";
    mm.on("tableFull", (config) => {
      tableId = config.tableId;
    });

    for (let i = 0; i < 6; i++) {
      mm.joinQueue(makePlayer(i), 1000);
    }

    expect(mm.isBettingWindowActive(tableId)).toBe(true);
    expect(mm.getBettingWindowRemaining(tableId)).toBe(60);
    mm.destroy();
  });

  it("emits bettingLocked after 60 seconds", () => {
    const mm = new Matchmaker(mockWsFeed as never);
    const lockedEvents: { tableId: string }[] = [];
    mm.on("bettingLocked", (config) => lockedEvents.push(config));

    for (let i = 0; i < 6; i++) {
      mm.joinQueue(makePlayer(i), 1000);
    }

    expect(lockedEvents).toHaveLength(0);
    vi.advanceTimersByTime(60000);
    expect(lockedEvents).toHaveLength(1);
    mm.destroy();
  });
});

describe("Matchmaker - rate limiting", () => {
  let mockWsFeed: MockWsFeed;
  let Matchmaker: typeof import("../matchmaker.js").Matchmaker;

  beforeEach(async () => {
    vi.useFakeTimers();
    const mod = await import("../matchmaker.js");
    Matchmaker = mod.Matchmaker;
    mockWsFeed = new MockWsFeed();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first bet", () => {
    const mm = new Matchmaker(mockWsFeed as never);
    expect(mm.recordBet("pool1", "user1")).toBe(true);
    mm.destroy();
  });

  it("rejects duplicate bet", () => {
    const mm = new Matchmaker(mockWsFeed as never);
    mm.recordBet("pool1", "user1");
    expect(mm.recordBet("pool1", "user1")).toBe(false);
    mm.destroy();
  });

  it("allows same user to bet on different pools", () => {
    const mm = new Matchmaker(mockWsFeed as never);
    expect(mm.recordBet("pool1", "user1")).toBe(true);
    expect(mm.recordBet("pool2", "user1")).toBe(true);
    mm.destroy();
  });

  it("hasBet returns correct state", () => {
    const mm = new Matchmaker(mockWsFeed as never);
    expect(mm.hasBet("pool1", "user1")).toBe(false);
    mm.recordBet("pool1", "user1");
    expect(mm.hasBet("pool1", "user1")).toBe(true);
    mm.destroy();
  });
});
