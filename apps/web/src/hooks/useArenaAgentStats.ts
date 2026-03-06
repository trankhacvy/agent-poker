"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { createSolanaRpc } from "@solana/kit";
import { fetchMaybeAgentAccount } from "@repo/program-clients/agent";
import { SOLANA_RPC_URL } from "@/lib/constants";
import { deriveAgentPda } from "@/lib/pda";
import type { ArenaAgentConfig } from "@/lib/arena-types";

function deriveVirtualBalance(totalGames: number, totalWins: number): number {
  const losses = totalGames - totalWins;
  return Math.max(50, 100 + totalWins * 10 - losses * 2);
}

export function useArenaAgentStats(agents: ArenaAgentConfig[]): ArenaAgentConfig[] {
  const [agentsWithBalances, setAgentsWithBalances] = useState(agents);
  const rpc = useMemo(() => createSolanaRpc(SOLANA_RPC_URL), []);
  const fetchedRef = useRef(false);
  const agentKeysRef = useRef("");

  // Only refetch when the agent pubkeys change (new round)
  const agentKeys = agents.map((a) => a.pubkey).join(",");

  useEffect(() => {
    if (agents.length === 0) return;

    // Avoid re-fetching for the same set of agents
    if (agentKeysRef.current === agentKeys && fetchedRef.current) {
      return;
    }
    agentKeysRef.current = agentKeys;

    let cancelled = false;

    async function fetchStats() {
      const updated = await Promise.all(
        agents.map(async (agent) => {
          try {
            const agentPda = await deriveAgentPda(agent.pubkey);
            const account = await fetchMaybeAgentAccount(rpc, agentPda);
            if (account.exists) {
              return {
                ...agent,
                virtualBalance: deriveVirtualBalance(
                  Number(account.data.totalGames),
                  Number(account.data.totalWins)
                ),
              };
            }
          } catch {
            // Agent account may not exist yet
          }
          return { ...agent, virtualBalance: agent.virtualBalance ?? 100 };
        })
      );
      if (!cancelled) {
        setAgentsWithBalances(updated);
        fetchedRef.current = true;
      }
    }

    fetchStats();

    return () => {
      cancelled = true;
    };
  }, [agents, agentKeys, rpc]);

  return agentsWithBalances;
}
