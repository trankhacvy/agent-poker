import type { TableInfo, AgentData } from "./types";
import { GAME_SERVER_URL } from "./constants";
import { adaptTable, adaptAgent, adaptLeaderboardEntry } from "./adapters";

export async function fetchTables(): Promise<TableInfo[]> {
  const res = await fetch(`${GAME_SERVER_URL}/api/tables`);
  if (!res.ok) return [];
  const json = (await res.json()) as { tables: unknown[] };
  return (json.tables ?? []).map((t) => adaptTable(t as Parameters<typeof adaptTable>[0]));
}

export async function fetchTable(tableId: string): Promise<TableInfo | null> {
  const res = await fetch(`${GAME_SERVER_URL}/api/tables/${tableId}`);
  if (!res.ok) return null;
  const json = await res.json();
  return adaptTable(json as Parameters<typeof adaptTable>[0]);
}

export async function joinQueue(params: {
  pubkey: string;
  displayName: string;
  template: number;
  wagerTier: number;
}): Promise<{ message: string; queueSize: number; wagerTier: number }> {
  const res = await fetch(`${GAME_SERVER_URL}/api/tables/auto/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(`joinQueue failed: ${res.status}`);
  }
  return res.json() as Promise<{ message: string; queueSize: number; wagerTier: number }>;
}

export async function fetchAgents(): Promise<AgentData[]> {
  const res = await fetch(`${GAME_SERVER_URL}/api/agents`);
  if (!res.ok) return [];
  const json = (await res.json()) as { agents: unknown[]; total: number };
  return (json.agents ?? []).map((a) => adaptAgent(a as Parameters<typeof adaptAgent>[0]));
}

export async function fetchAgent(pubkey: string): Promise<AgentData | null> {
  const res = await fetch(`${GAME_SERVER_URL}/api/agents/${pubkey}`);
  if (!res.ok) return null;
  const json = await res.json();
  return adaptAgent(json as Parameters<typeof adaptAgent>[0]);
}

export async function fetchLeaderboard(): Promise<AgentData[]> {
  const res = await fetch(`${GAME_SERVER_URL}/api/leaderboard`);
  if (!res.ok) return [];
  const json = (await res.json()) as { leaderboard: unknown[] };
  return (json.leaderboard ?? []).map((e) =>
    adaptLeaderboardEntry(e as Parameters<typeof adaptLeaderboardEntry>[0])
  );
}

export interface GameHistoryRecord {
  gameId: string;
  tableId: string;
  wagerTier: number;
  pot: number;
  winnerIndex: number;
  players: {
    pubkey: string;
    displayName: string;
    template: number;
    seatIndex: number;
    isWinner: boolean;
  }[];
  completedAt: number;
}

export async function fetchAgentGames(
  pubkey: string,
  offset = 0,
  limit = 20
): Promise<{ games: GameHistoryRecord[]; total: number }> {
  const res = await fetch(
    `${GAME_SERVER_URL}/api/agents/${pubkey}/games?offset=${offset}&limit=${limit}`
  );
  if (!res.ok) return { games: [], total: 0 };
  return res.json() as Promise<{ games: GameHistoryRecord[]; total: number }>;
}

export interface StatsData {
  totalGamesPlayed: number;
  totalAgents: number;
  activeGames: number;
  totalVolume: number;
}

export async function fetchStats(): Promise<StatsData | null> {
  const res = await fetch(`${GAME_SERVER_URL}/api/stats`);
  if (!res.ok) return null;
  return res.json() as Promise<StatsData>;
}

export async function fetchBettingPool(
  tableId: string
): Promise<{ totalPool: number; agentPools: Record<string, number> }> {
  const res = await fetch(`${GAME_SERVER_URL}/api/tables/${tableId}/pool`);
  if (!res.ok) return { totalPool: 0, agentPools: {} };
  // Server stores amounts in SOL already, no conversion needed
  return res.json() as Promise<{ totalPool: number; agentPools: Record<string, number> }>;
}

export async function placeBet(params: {
  tableId: string;
  wallet: string;
  agentPubkey: string;
  amount: number;
}): Promise<{ success: boolean }> {
  const res = await fetch(`${GAME_SERVER_URL}/api/tables/${params.tableId}/bet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: params.wallet,
      agentPubkey: params.agentPubkey,
      amount: params.amount,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Bet failed" }));
    throw new Error((err as { message: string }).message);
  }
  return res.json() as Promise<{ success: boolean }>;
}

