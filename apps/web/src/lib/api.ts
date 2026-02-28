import type { TableInfo, AgentData, GameStateSnapshot } from "./types";
import { GAME_SERVER_URL, WAGER_TIERS } from "./constants";
import { adaptTable, adaptAgent, adaptLeaderboardEntry, adaptGameState } from "./adapters";

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

export async function fetchGameState(gameId: string): Promise<GameStateSnapshot | null> {
  const res = await fetch(`${GAME_SERVER_URL}/api/games/${gameId}`);
  if (!res.ok) return null;
  const json = await res.json();
  return adaptGameState(json as Parameters<typeof adaptGameState>[0]);
}
