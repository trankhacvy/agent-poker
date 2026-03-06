export interface ArenaAgentConfig {
  id: string;
  pubkey: string;
  displayName: string;
  template: number;
  personality: string;
  avatar: string;
  color: string;
  virtualBalance?: number;
}

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
  agents: ArenaAgentConfig[];
  bettingSecondsRemaining: number | null;
  cooldownSecondsRemaining: number | null;
}
