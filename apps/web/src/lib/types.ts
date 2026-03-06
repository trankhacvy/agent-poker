export type Suit = "hearts" | "diamonds" | "clubs" | "spades";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";

export interface CardInfo {
  rank: Rank;
  suit: Suit;
  code: number;
}

export type PlayerStatus = "active" | "folded" | "all-in" | "sitting-out";

export interface PlayerSnapshot {
  seatIndex: number;
  publicKey: string;
  displayName: string;
  templateId: number;
  chips: number;
  currentBet: number;
  cards: number[];
  status: PlayerStatus;
  isDealer: boolean;
}

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export interface GameStateSnapshot {
  tableId: string;
  street: Street;
  pot: number;
  communityCards: number[];
  players: PlayerSnapshot[];
  currentPlayerIndex: number;
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  minRaise: number;
  isShowdown: boolean;
  winnerIndex?: number;
}

export type ActionType = "fold" | "check" | "call" | "raise" | "all-in" | "post-blind" | "deal";

export interface GameAction {
  id: string;
  tableId: string;
  playerName: string;
  playerPublicKey: string;
  actionType: ActionType;
  amount: number;
  timestamp: number;
  reasoning?: string;
}

export type TableStatus = "open" | "full" | "in-progress" | "settled";

export interface TablePlayer {
  pubkey: string;
  displayName: string;
  template: number;
  seatIndex: number;
}

export interface TableInfo {
  tableId: string;
  status: TableStatus;
  wagerTierIndex: number;
  playerCount: number;
  maxPlayers: number;
  createdAt: number;
  players: TablePlayer[];
}

export type WsMessageType =
  | "game_state"
  | "action"
  | "table_list"
  | "error"
  | "subscribe_ack"
  | "unsubscribe_ack";

export interface WsMessage {
  type: WsMessageType;
  payload: GameStateSnapshot | GameAction | TableInfo[] | { message: string } | { tableId: string };
}

export interface AgentData {
  publicKey: string;
  owner: string;
  displayName: string;
  templateId: number;
  balance: number;
  gamesPlayed: number;
  wins: number;
  earnings: number;
  createdAt: number;
}

export interface LeaderboardEntry {
  rank: number;
  agent: AgentData;
}

export interface BettingPool {
  tableId: string;
  totalPool: number;
  agentPools: Record<string, number>;
  odds: Record<string, number>;
}

export type GamePhase = "waiting" | "playing" | "showdown" | "complete";

export interface ShowdownResult {
  publicKey: string;
  displayName: string;
  cards: number[];
  handName: string;
  isWinner: boolean;
}

export interface GameResult {
  winnerPublicKey: string;
  winnerName: string;
  potAmount: number;
  showdownResults: ShowdownResult[];
}

export interface QueueStatus {
  agentPublicKey: string;
  tableId: string;
  playerCount: number;
  maxPlayers: number;
}

export interface UserBet {
  agentPublicKey: string;
  agentName: string;
  amount: number;
  timestamp: number;
}

export interface BettingResult {
  won: boolean;
  payout: number;
  betAmount: number;
}
