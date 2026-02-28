import { describe, it, expect } from "vitest";
import type { GameAction, GameStateSnapshot, PlayerSnapshot } from "../types.js";

const VALID_ACTIONS: GameAction["type"][] = [
  "fold",
  "check",
  "call",
  "raise",
  "all_in",
];

function parseAction(text: string): GameAction {
  const jsonMatch = text.match(/\{[^}]+\}/);
  if (!jsonMatch) {
    return { type: "fold" };
  }

  try {
    const parsed: { type?: string; amount?: number } = JSON.parse(
      jsonMatch[0]
    );
    const actionType = parsed.type as GameAction["type"] | undefined;

    if (!actionType || !VALID_ACTIONS.includes(actionType)) {
      return { type: "fold" };
    }

    if (actionType === "raise" && typeof parsed.amount === "number") {
      return { type: "raise", amount: parsed.amount };
    }

    return { type: actionType };
  } catch {
    return { type: "fold" };
  }
}

function makeMockGameState(overrides: Partial<GameStateSnapshot> = {}): GameStateSnapshot {
  const defaultPlayers: PlayerSnapshot[] = Array.from({ length: 6 }, (_, i) => ({
    pubkey: `player${i}`,
    displayName: `Player ${i}`,
    template: i % 4,
    seatIndex: i,
    status: "active" as const,
    currentBet: 0,
    holeCards: [i * 2, i * 2 + 1] as [number, number],
  }));

  return {
    gameId: "test-game-1",
    tableId: "test-table-1",
    phase: "preflop",
    pot: 150,
    currentBet: 100,
    currentPlayer: 0,
    communityCards: [],
    players: defaultPlayers,
    ...overrides,
  };
}

describe("LLM Gateway - parseAction", () => {
  it("parses valid fold action", () => {
    const result = parseAction('{"type": "fold"}');
    expect(result).toEqual({ type: "fold" });
  });

  it("parses valid check action", () => {
    const result = parseAction('{"type": "check"}');
    expect(result).toEqual({ type: "check" });
  });

  it("parses valid call action", () => {
    const result = parseAction('{"type": "call"}');
    expect(result).toEqual({ type: "call" });
  });

  it("parses valid raise with amount", () => {
    const result = parseAction('{"type": "raise", "amount": 500}');
    expect(result).toEqual({ type: "raise", amount: 500 });
  });

  it("parses all_in action", () => {
    const result = parseAction('{"type": "all_in"}');
    expect(result).toEqual({ type: "all_in" });
  });

  it("extracts JSON from surrounding text", () => {
    const result = parseAction(
      'I think the best play here is to call. {"type": "call"} That should work.'
    );
    expect(result).toEqual({ type: "call" });
  });

  it("falls back to fold for empty response", () => {
    const result = parseAction("");
    expect(result).toEqual({ type: "fold" });
  });

  it("falls back to fold for non-JSON response", () => {
    const result = parseAction("I want to raise but I'm not sure");
    expect(result).toEqual({ type: "fold" });
  });

  it("falls back to fold for invalid action type", () => {
    const result = parseAction('{"type": "bluff"}');
    expect(result).toEqual({ type: "fold" });
  });

  it("falls back to fold for malformed JSON", () => {
    const result = parseAction('{"type": "call"');
    expect(result).toEqual({ type: "fold" });
  });

  it("raise without amount returns raise without amount", () => {
    const result = parseAction('{"type": "raise"}');
    expect(result).toEqual({ type: "raise" });
  });

  it("ignores extra fields", () => {
    const result = parseAction('{"type": "check", "reason": "I have nothing"}');
    expect(result).toEqual({ type: "check" });
  });
});

describe("LLM Gateway - mock game state", () => {
  it("creates valid game state with defaults", () => {
    const state = makeMockGameState();
    expect(state.players).toHaveLength(6);
    expect(state.phase).toBe("preflop");
    expect(state.pot).toBe(150);
  });

  it("creates game state with overrides", () => {
    const state = makeMockGameState({ phase: "flop", pot: 300, communityCards: [10, 20, 30] });
    expect(state.phase).toBe("flop");
    expect(state.pot).toBe(300);
    expect(state.communityCards).toEqual([10, 20, 30]);
  });

  it("each template index is valid (0-3)", () => {
    const state = makeMockGameState();
    for (const player of state.players) {
      expect(player.template).toBeGreaterThanOrEqual(0);
      expect(player.template).toBeLessThanOrEqual(3);
    }
  });
});
