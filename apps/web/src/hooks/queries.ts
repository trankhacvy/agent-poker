import { useQuery } from "@tanstack/react-query";
import {
  fetchStats,
  fetchTables,
  fetchBettingPool,
  fetchAgents,
  fetchAgent,
  fetchLeaderboard,
  fetchAgentGames,
} from "@/lib/api";

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
    refetchInterval: 30_000,
  });
}

export function useTables() {
  return useQuery({
    queryKey: ["tables"],
    queryFn: fetchTables,
    refetchInterval: 15_000,
  });
}

export function useBettingPool(tableId: string | null) {
  return useQuery({
    queryKey: ["bettingPool", tableId],
    queryFn: () => fetchBettingPool(tableId!),
    enabled: !!tableId,
  });
}

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: fetchAgents,
  });
}

export function useAgent(pubkey: string | null) {
  return useQuery({
    queryKey: ["agent", pubkey],
    queryFn: () => fetchAgent(pubkey!),
    enabled: !!pubkey,
  });
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ["leaderboard"],
    queryFn: fetchLeaderboard,
  });
}

export function useAgentGames(pubkey: string, offset = 0, limit = 20) {
  return useQuery({
    queryKey: ["agentGames", pubkey, offset, limit],
    queryFn: () => fetchAgentGames(pubkey, offset, limit),
    enabled: !!pubkey,
  });
}
