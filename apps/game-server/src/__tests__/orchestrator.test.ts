import { describe, it, expect } from "vitest";

function generateShuffledDeck(): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    const j = arr[0] % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardName(card: number): string {
  const values = [
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "T",
    "J",
    "Q",
    "K",
    "A",
  ];
  const suits = ["\u2665", "\u2666", "\u2663", "\u2660"];
  const value = card % 13;
  const suit = Math.floor(card / 13);
  return `${values[value]}${suits[suit]}`;
}

describe("Orchestrator - deck generation", () => {
  it("generates a deck with all 52 unique cards", () => {
    const deck = generateShuffledDeck();
    expect(deck).toHaveLength(52);
    const unique = new Set(deck);
    expect(unique.size).toBe(52);
  });

  it("contains cards 0-51", () => {
    const deck = generateShuffledDeck();
    const sorted = [...deck].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });

  it("produces different shuffles", () => {
    const deck1 = generateShuffledDeck();
    const deck2 = generateShuffledDeck();
    let differences = 0;
    for (let i = 0; i < 52; i++) {
      if (deck1[i] !== deck2[i]) differences++;
    }
    expect(differences).toBeGreaterThan(0);
  });
});

describe("Orchestrator - card naming", () => {
  it("formats card 0 as 2 of hearts", () => {
    expect(cardName(0)).toBe("2\u2665");
  });

  it("formats card 12 as A of hearts", () => {
    expect(cardName(12)).toBe("A\u2665");
  });

  it("formats card 13 as 2 of diamonds", () => {
    expect(cardName(13)).toBe("2\u2666");
  });

  it("formats card 51 as A of spades", () => {
    expect(cardName(51)).toBe("A\u2660");
  });

  it("formats card 21 as T of diamonds", () => {
    expect(cardName(21)).toBe("T\u2666");
  });
});

describe("Orchestrator - game state tracking", () => {
  interface LocalGameState {
    phase: string;
    pot: number;
    currentBet: number;
    currentPlayer: number;
    playerStatuses: string[];
    playerBets: number[];
  }

  function createLocalState(playerCount: number): LocalGameState {
    return {
      phase: "preflop",
      pot: 0,
      currentBet: 0,
      currentPlayer: 0,
      playerStatuses: Array(playerCount).fill("active"),
      playerBets: Array(playerCount).fill(0),
    };
  }

  function applyFold(state: LocalGameState, playerIdx: number): void {
    state.playerStatuses[playerIdx] = "folded";
  }

  function applyCall(state: LocalGameState, playerIdx: number): void {
    const diff = state.currentBet - state.playerBets[playerIdx];
    state.playerBets[playerIdx] = state.currentBet;
    state.pot += diff;
  }

  function applyRaise(
    state: LocalGameState,
    playerIdx: number,
    amount: number
  ): void {
    const diff = amount - state.playerBets[playerIdx];
    state.playerBets[playerIdx] = amount;
    state.currentBet = amount;
    state.pot += diff;
  }

  function countActive(state: LocalGameState): number {
    return state.playerStatuses.filter(
      (s) => s === "active" || s === "all_in"
    ).length;
  }

  it("creates state with correct player count", () => {
    const state = createLocalState(6);
    expect(state.playerStatuses).toHaveLength(6);
    expect(state.playerBets).toHaveLength(6);
  });

  it("fold reduces active player count", () => {
    const state = createLocalState(6);
    expect(countActive(state)).toBe(6);
    applyFold(state, 0);
    expect(countActive(state)).toBe(5);
    expect(state.playerStatuses[0]).toBe("folded");
  });

  it("call increases pot correctly", () => {
    const state = createLocalState(6);
    state.currentBet = 100;
    state.playerBets[2] = 50;
    applyCall(state, 2);
    expect(state.pot).toBe(50);
    expect(state.playerBets[2]).toBe(100);
  });

  it("raise updates current bet and pot", () => {
    const state = createLocalState(6);
    state.currentBet = 100;
    applyRaise(state, 0, 200);
    expect(state.currentBet).toBe(200);
    expect(state.pot).toBe(200);
    expect(state.playerBets[0]).toBe(200);
  });

  it("simulates a full round of folds", () => {
    const state = createLocalState(6);
    state.currentBet = 100;
    for (let i = 0; i < 5; i++) {
      applyFold(state, i);
    }
    expect(countActive(state)).toBe(1);
  });
});
