"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ArenaAgentConfig, ArenaState } from "@/lib/arena-types";
import { GAME_SERVER_URL, GAME_SERVER_WS_URL } from "@/lib/constants";

export interface AgentActionEvent {
  id: string;
  seatIndex: number;
  playerName: string;
  action: string;
  amount: number;
  timestamp: number;
  reasoning?: string;
}

interface LastWinner {
  name: string;
  index: number;
  pot: number;
}

export interface UseArenaLifecycleReturn {
  arenaState: ArenaState;
  roundNumber: number;
  tableId: string | null;
  gameId: string | null;
  agents: ArenaAgentConfig[];
  bettingCountdown: number | null;
  cooldownCountdown: number | null;
  agentActions: AgentActionEvent[];
  lastWinner: LastWinner | null;
  gameEnded: boolean;
  gateFailedReason: string | null;
  isConnected: boolean;
}

let actionIdCounter = 0;

export function useArenaLifecycle(): UseArenaLifecycleReturn {
  const [arenaState, setArenaState] = useState<ArenaState>("idle");
  const [roundNumber, setRoundNumber] = useState(0);
  const [tableId, setTableId] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [agents, setAgents] = useState<ArenaAgentConfig[]>([]);
  const [bettingCountdown, setBettingCountdown] = useState<number | null>(null);
  const [cooldownCountdown, setCooldownCountdown] = useState<number | null>(null);
  const [agentActions, setAgentActions] = useState<AgentActionEvent[]>([]);
  const [lastWinner, setLastWinner] = useState<LastWinner | null>(null);
  const [gameEnded, setGameEnded] = useState(false);
  const [gateFailedReason, setGateFailedReason] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(GAME_SERVER_WS_URL);

    ws.onopen = () => {
      setIsConnected(true);
      ws.send(JSON.stringify({ type: "subscribe", channel: "arena" }));

      // Fetch current arena status to catch up
      fetch(`${GAME_SERVER_URL}/api/arena/status`)
        .then((r) => r.json())
        .then((status: Record<string, unknown>) => {
          if (status.state) setArenaState(status.state as ArenaState);
          if (status.roundNumber) setRoundNumber(status.roundNumber as number);
          if (status.currentTableId) setTableId(status.currentTableId as string);
          if (status.currentGameId) setGameId(status.currentGameId as string);
          if (status.bettingSecondsRemaining != null)
            setBettingCountdown(status.bettingSecondsRemaining as number);
          if (status.cooldownSecondsRemaining != null)
            setCooldownCountdown(status.cooldownSecondsRemaining as number);
          if (Array.isArray(status.agents) && (status.agents as ArenaAgentConfig[]).length > 0)
            setAgents(status.agents as ArenaAgentConfig[]);
        })
        .catch(() => {});
    };

    ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data as string);
        const type = raw.type as string;
        const data = raw.data as Record<string, unknown>;

        switch (type) {
          case "arena_round_start": {
            setArenaState("betting");
            setRoundNumber(data.roundNumber as number);
            setTableId(data.tableId as string);
            setGameId(null);
            setBettingCountdown(data.secondsRemaining as number);
            setAgents(data.agents as ArenaAgentConfig[]);
            setAgentActions([]);
            setGameEnded(false);
            setGateFailedReason(null);
            setLastWinner(null);
            break;
          }
          case "arena_betting_countdown": {
            setBettingCountdown(data.secondsRemaining as number);
            break;
          }
          case "arena_betting_locked": {
            setBettingCountdown(0);
            setArenaState("playing");
            // Poll for gameId since the game is being created on-chain
            const pollGameId = () => {
              fetch(`${GAME_SERVER_URL}/api/arena/status`)
                .then((r) => r.json())
                .then((s: Record<string, unknown>) => {
                  if (s.currentGameId) {
                    setGameId(s.currentGameId as string);
                  } else {
                    setTimeout(pollGameId, 2000);
                  }
                })
                .catch(() => {});
            };
            setTimeout(pollGameId, 3000);
            break;
          }
          case "arena_gate_failed": {
            setGateFailedReason(data.reason as string);
            setBettingCountdown(null);
            setArenaState("refunding");
            break;
          }
          case "arena_agent_action": {
            const actionEvent: AgentActionEvent = {
              id: `action-${++actionIdCounter}`,
              seatIndex: data.seatIndex as number,
              playerName: data.playerName as string,
              action: data.action as string,
              amount: data.amount as number,
              timestamp: raw.timestamp as number,
              reasoning: (data.reasoning as string) || undefined,
            };
            setAgentActions((prev) => [...prev.slice(-99), actionEvent]);
            // Track gameId from the message
            if (raw.gameId) setGameId(raw.gameId as string);
            break;
          }
          case "arena_game_end": {
            setLastWinner({
              name: data.winnerName as string,
              index: data.winnerIndex as number,
              pot: data.pot as number,
            });
            setGameEnded(true);
            if (raw.gameId) setGameId(raw.gameId as string);
            break;
          }
          case "arena_game_failed": {
            setGameEnded(true);
            break;
          }
          case "arena_cooldown": {
            setCooldownCountdown(data.secondsRemaining as number);
            setArenaState("cooldown");
            break;
          }
          case "arena_error": {
            break;
          }
          case "subscribe_ack":
            break;
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    arenaState,
    roundNumber,
    tableId,
    gameId,
    agents,
    bettingCountdown,
    cooldownCountdown,
    agentActions,
    lastWinner,
    gameEnded,
    gateFailedReason,
    isConnected,
  };
}
