import { GamePhase, type GameState } from "@repo/program-clients/game";
import { type BettingPool, PoolStatus } from "@repo/program-clients/betting";
import type { GameStateSnapshot, PlayerSnapshot, Street } from "./types";

const LAMPORTS_PER_SOL = 1_000_000_000;

const PHASE_TO_STREET: Record<GamePhase, Street> = {
  [GamePhase.Waiting]: "preflop",
  [GamePhase.Preflop]: "preflop",
  [GamePhase.Flop]: "flop",
  [GamePhase.Turn]: "turn",
  [GamePhase.River]: "river",
  [GamePhase.Showdown]: "showdown",
  [GamePhase.Complete]: "showdown",
};

const STATUS_MAP: Record<number, PlayerSnapshot["status"]> = {
  0: "sitting-out", // empty
  1: "active",
  2: "folded",
  3: "all-in",
};

export function mapGameStateToSnapshot(
  gs: GameState,
  holeCards: Map<number, [number, number]>,
  agentNames: Map<string, { displayName: string; template: number }>
): GameStateSnapshot {
  const players: PlayerSnapshot[] = [];
  for (let i = 0; i < gs.playerCount; i++) {
    const pubkey = gs.players[i]!;
    const agent = agentNames.get(pubkey);
    const statusByte = gs.playerStatus[i] ?? 0;
    const cards = holeCards.get(i);

    players.push({
      seatIndex: i,
      publicKey: pubkey,
      displayName: agent?.displayName ?? `Player ${i}`,
      templateId: agent?.template ?? 0,
      chips: Number(gs.wagerTier) / LAMPORTS_PER_SOL,
      currentBet: Number(gs.playerBets[i] ?? BigInt(0)) / LAMPORTS_PER_SOL,
      cards: cards ? [...cards] : [-1, -1],
      status: STATUS_MAP[statusByte] ?? "active",
      isDealer: i === gs.dealerIndex,
    });
  }

  const communityCards = Array.from(gs.communityCards).slice(0, gs.communityCount);
  const bbAmount = (Number(gs.wagerTier) * 100) / 1000;
  const sbAmount = bbAmount / 2;

  return {
    tableId: gs.tableId.toString(),
    street: PHASE_TO_STREET[gs.phase] ?? "preflop",
    pot: Number(gs.pot) / LAMPORTS_PER_SOL,
    communityCards: Array.from(communityCards),
    players,
    currentPlayerIndex: gs.currentPlayer,
    dealerIndex: gs.dealerIndex,
    smallBlind: sbAmount / LAMPORTS_PER_SOL,
    bigBlind: bbAmount / LAMPORTS_PER_SOL,
    minRaise: (bbAmount * 2) / LAMPORTS_PER_SOL,
    isShowdown: gs.phase === GamePhase.Showdown || gs.phase === GamePhase.Complete,
    winnerIndex: gs.winnerIndex < gs.playerCount ? gs.winnerIndex : undefined,
  };
}

export function mapPoolStatus(pool: BettingPool): {
  totalPool: number;
  status: "open" | "locked" | "settled";
  betCount: number;
} {
  // @ts-expect-error
  const statusMap: Record<PoolStatus, "open" | "locked" | "settled"> = {
    [PoolStatus.Open]: "open",
    [PoolStatus.Locked]: "locked",
    [PoolStatus.Settled]: "settled",
  };
  return {
    totalPool: Number(pool.totalPool) / LAMPORTS_PER_SOL,
    status: statusMap[pool.status] ?? "open",
    betCount: pool.betCount,
  };
}

export function isGameActive(phase: GamePhase): boolean {
  return phase !== GamePhase.Waiting && phase !== GamePhase.Complete;
}
