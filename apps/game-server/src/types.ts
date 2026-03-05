export interface GameConfig {
  gameId: string;
  tableId: string;
  wagerTier: number;
  players: PlayerInfo[];
}

export interface PlayerInfo {
  pubkey: string;
  displayName: string;
  template: number;
  seatIndex: number;
}

export interface GameAction {
  type: "fold" | "check" | "call" | "raise" | "all_in";
  amount?: number;
}

export interface GameStateSnapshot {
  gameId: string;
  tableId: string;
  phase: string;
  pot: number;
  currentBet: number;
  currentPlayer: number;
  communityCards: number[];
  players: PlayerSnapshot[];
  lastAction?: { playerIndex: number; action: GameAction };
  winnerIndex?: number;
  bigBlind?: number;
  dealerIndex?: number;
}

export interface PlayerSnapshot {
  pubkey: string;
  displayName: string;
  template: number;
  seatIndex: number;
  status: "active" | "folded" | "all_in" | "empty";
  currentBet: number;
  holeCards?: [number, number];
}

export interface TableInfo {
  tableId: string;
  wagerTier: number;
  playerCount: number;
  maxPlayers: number;
  status: "open" | "full" | "in_progress" | "settled";
  players: PlayerInfo[];
}

export interface BettingWindowData {
  tableId: string;
  secondsRemaining: number;
  wagerTier: number;
  players: PlayerInfo[];
}

export interface QueueTimeoutData {
  wagerTier: number;
  refundedPlayers: PlayerInfo[];
}

export interface WsMessage {
  type:
    | "game_state"
    | "game_action"
    | "game_start"
    | "game_end"
    | "table_update"
    | "betting_countdown"
    | "betting_locked"
    | "queue_timeout"
    | "pool_update"
    | "next_game_countdown"
    | "arena_state_change"
    | "arena_betting_open"
    | "arena_betting_countdown"
    | "arena_betting_locked"
    | "arena_gate_failed"
    | "arena_game_complete"
    | "arena_game_failed"
    | "arena_cooldown"
    | "arena_pool_update"
    | "arena_error"
    | "error";
  data:
    | GameStateSnapshot
    | GameAction
    | TableInfo
    | BettingWindowData
    | QueueTimeoutData
    | { totalPool: number; agentPools: Record<string, number> }
    | { secondsRemaining: number }
    | { message: string }
    | Record<string, unknown>;
  gameId?: string;
  tableId?: string;
  timestamp: number;
}
