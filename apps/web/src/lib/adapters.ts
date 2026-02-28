import type {
  GameStateSnapshot,
  PlayerSnapshot,
  GameAction,
  TableInfo,
  TableStatus,
  Street,
  PlayerStatus,
  AgentData,
} from "./types";
import { WAGER_TIERS } from "./constants";

interface BackendPlayerSnapshot {
  pubkey: string;
  displayName: string;
  template: number;
  seatIndex: number;
  status: "active" | "folded" | "all_in" | "empty";
  currentBet: number;
  holeCards?: [number, number];
}

interface BackendGameState {
  gameId: string;
  tableId: string;
  phase: string;
  pot: number;
  currentBet: number;
  currentPlayer: number;
  communityCards: number[];
  players: BackendPlayerSnapshot[];
  lastAction?: { playerIndex: number; action: { type: string; amount?: number } };
}

interface BackendTableInfo {
  tableId: string;
  wagerTier: number;
  playerCount: number;
  maxPlayers: number;
  status: "open" | "full" | "in_progress" | "settled";
  players: { pubkey: string; displayName: string; template: number; seatIndex: number }[];
}

interface BackendWsMessage {
  type: string;
  data: unknown;
  gameId?: string;
  tableId?: string;
  timestamp: number;
}

interface BackendAgentRecord {
  pubkey: string;
  displayName: string;
  template: number;
  gamesPlayed: number;
  wins: number;
}

interface BackendLeaderboardEntry {
  pubkey: string;
  displayName: string;
  template: number;
  wins: number;
  gamesPlayed: number;
}

const PHASE_TO_STREET: Record<string, Street> = {
  preflop: "preflop",
  flop: "flop",
  turn: "turn",
  river: "river",
  showdown: "showdown",
  settled: "showdown",
};

export function adaptStreet(phase: string): Street {
  return PHASE_TO_STREET[phase] ?? "preflop";
}

const STATUS_MAP: Record<string, PlayerStatus> = {
  active: "active",
  folded: "folded",
  all_in: "all-in",
  empty: "sitting-out",
};

export function adaptPlayerStatus(status: string): PlayerStatus {
  return STATUS_MAP[status] ?? "active";
}

const TABLE_STATUS_MAP: Record<string, TableStatus> = {
  open: "open",
  full: "full",
  in_progress: "in-progress",
  settled: "settled",
};

export function adaptTableStatus(status: string): TableStatus {
  return TABLE_STATUS_MAP[status] ?? "open";
}

export function wagerTierToIndex(lamports: number): number {
  const idx = WAGER_TIERS.findIndex((t) => t.lamports === lamports);
  return idx >= 0 ? idx : 0;
}

export function adaptPlayer(
  p: BackendPlayerSnapshot,
  dealerIndex: number,
  wagerTier: number
): PlayerSnapshot {
  return {
    seatIndex: p.seatIndex,
    publicKey: p.pubkey,
    displayName: p.displayName,
    templateId: p.template,
    chips: wagerTier,
    currentBet: p.currentBet,
    cards: p.holeCards ? [...p.holeCards] : [-1, -1],
    status: adaptPlayerStatus(p.status),
    isDealer: p.seatIndex === dealerIndex,
  };
}

export function adaptGameState(raw: BackendGameState): GameStateSnapshot {
  const dealerIndex = 0;
  const wagerTier = 0;
  const sbAmount = Math.round(wagerTier * 50 / 1000) || 10;
  const bbAmount = Math.round(wagerTier * 100 / 1000) || 20;

  return {
    tableId: raw.tableId,
    street: adaptStreet(raw.phase),
    pot: raw.pot,
    communityCards: raw.communityCards,
    players: raw.players.map((p) => adaptPlayer(p, dealerIndex, wagerTier)),
    currentPlayerIndex: raw.currentPlayer,
    dealerIndex,
    smallBlind: sbAmount,
    bigBlind: bbAmount,
    minRaise: bbAmount * 2,
    isShowdown: raw.phase === "showdown" || raw.phase === "settled",
  };
}

export function adaptGameStateWithWager(
  raw: BackendGameState,
  wagerTierLamports: number
): GameStateSnapshot {
  const dealerIndex = 0;
  const sbAmount = Math.round(wagerTierLamports * 50 / 1000);
  const bbAmount = Math.round(wagerTierLamports * 100 / 1000);

  return {
    tableId: raw.tableId,
    street: adaptStreet(raw.phase),
    pot: raw.pot,
    communityCards: raw.communityCards,
    players: raw.players.map((p) => adaptPlayer(p, dealerIndex, wagerTierLamports)),
    currentPlayerIndex: raw.currentPlayer,
    dealerIndex,
    smallBlind: sbAmount,
    bigBlind: bbAmount,
    minRaise: bbAmount * 2,
    isShowdown: raw.phase === "showdown" || raw.phase === "settled",
  };
}

export function adaptTable(raw: BackendTableInfo): TableInfo {
  return {
    tableId: raw.tableId,
    status: adaptTableStatus(raw.status),
    wagerTierIndex: wagerTierToIndex(raw.wagerTier),
    playerCount: raw.playerCount,
    maxPlayers: raw.maxPlayers,
    createdAt: Date.now(),
    players: raw.players ?? [],
  };
}

let actionCounter = 0;

export function adaptLastAction(
  raw: BackendGameState
): GameAction | null {
  if (!raw.lastAction) return null;
  const player = raw.players[raw.lastAction.playerIndex];
  if (!player) return null;

  const actionType = raw.lastAction.action.type.replace("_", "-") as GameAction["actionType"];

  return {
    id: `action-${++actionCounter}`,
    tableId: raw.tableId,
    playerName: player.displayName,
    playerPublicKey: player.pubkey,
    actionType,
    amount: raw.lastAction.action.amount ?? 0,
    timestamp: Date.now(),
  };
}

interface BettingCountdownPayload {
  tableId: string;
  secondsRemaining: number;
  wagerTier: number;
  players: { pubkey: string; displayName: string; template: number; seatIndex: number }[];
}

export interface AdaptedWsMessage {
  type:
    | "game_state"
    | "game_action"
    | "game_start"
    | "game_end"
    | "table_update"
    | "betting_countdown"
    | "betting_locked"
    | "subscribe_ack"
    | "error";
  gameState?: GameStateSnapshot;
  action?: GameAction;
  table?: TableInfo;
  bettingCountdown?: { tableId: string; secondsRemaining: number };
  gameId?: string;
  tableId?: string;
  raw: BackendWsMessage;
}

export function adaptWsMessage(raw: BackendWsMessage): AdaptedWsMessage {
  const result: AdaptedWsMessage = {
    type: raw.type as AdaptedWsMessage["type"],
    gameId: raw.gameId,
    tableId: raw.tableId,
    raw,
  };

  switch (raw.type) {
    case "game_state": {
      const data = raw.data as BackendGameState;
      result.gameState = adaptGameState(data);
      const action = adaptLastAction(data);
      if (action) result.action = action;
      break;
    }
    case "game_action": {
      result.type = "game_action";
      const data = raw.data as BackendGameState;
      result.gameState = adaptGameState(data);
      const action = adaptLastAction(data);
      if (action) result.action = action;
      break;
    }
    case "game_start": {
      const data = raw.data as BackendGameState;
      result.gameState = adaptGameState(data);
      break;
    }
    case "game_end": {
      const data = raw.data as BackendGameState;
      result.gameState = adaptGameState(data);
      break;
    }
    case "table_update": {
      const data = raw.data as BackendTableInfo;
      result.table = adaptTable(data);
      break;
    }
    case "betting_countdown": {
      const data = raw.data as BettingCountdownPayload;
      result.bettingCountdown = {
        tableId: data.tableId,
        secondsRemaining: data.secondsRemaining,
      };
      break;
    }
    case "betting_locked": {
      const data = raw.data as BettingCountdownPayload;
      result.bettingCountdown = {
        tableId: data.tableId,
        secondsRemaining: 0,
      };
      break;
    }
    case "subscribe_ack":
    case "error":
      break;
  }

  return result;
}

export function adaptAgent(raw: BackendAgentRecord): AgentData {
  return {
    publicKey: raw.pubkey,
    owner: "",
    displayName: raw.displayName,
    templateId: raw.template,
    balance: 0,
    gamesPlayed: raw.gamesPlayed,
    wins: raw.wins,
    earnings: 0,
    createdAt: 0,
  };
}

export function adaptLeaderboardEntry(raw: BackendLeaderboardEntry): AgentData {
  return {
    publicKey: raw.pubkey,
    owner: "",
    displayName: raw.displayName,
    templateId: raw.template,
    balance: 0,
    gamesPlayed: raw.gamesPlayed,
    wins: raw.wins,
    earnings: 0,
    createdAt: 0,
  };
}
