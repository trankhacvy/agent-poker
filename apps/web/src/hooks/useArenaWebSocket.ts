"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameStateSnapshot, GameAction } from "@/lib/types";
import type { ArenaAgentConfig, ArenaState, ArenaPoolData } from "@/lib/arena-types";
import { GAME_SERVER_URL, GAME_SERVER_WS_URL } from "@/lib/constants";
import { adaptWsMessage } from "@/lib/adapters";

interface LastWinner {
  name: string;
  index: number;
  pot: number;
}

export interface UseArenaWebSocketReturn {
  arenaState: ArenaState;
  gameState: GameStateSnapshot | null;
  actions: GameAction[];
  agents: ArenaAgentConfig[];
  bettingCountdown: number | null;
  cooldownCountdown: number | null;
  poolData: ArenaPoolData;
  roundNumber: number;
  lastWinner: LastWinner | null;
  gameEnded: boolean;
  gateFailedReason: string | null;
  isConnected: boolean;
}

export function useArenaWebSocket(): UseArenaWebSocketReturn {
  const [arenaState, setArenaState] = useState<ArenaState>("idle");
  const [gameState, setGameState] = useState<GameStateSnapshot | null>(null);
  const [actions, setActions] = useState<GameAction[]>([]);
  const [agents, setAgents] = useState<ArenaAgentConfig[]>([]);
  const [bettingCountdown, setBettingCountdown] = useState<number | null>(null);
  const [cooldownCountdown, setCooldownCountdown] = useState<number | null>(null);
  const [poolData, setPoolData] = useState<ArenaPoolData>({ totalPool: 0, agentPools: {} });
  const [roundNumber, setRoundNumber] = useState(0);
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
      // Subscribe to the arena channel
      ws.send(JSON.stringify({ type: "subscribe", channel: "arena" }));
      // Fetch current arena status to catch up on missed messages
      fetch(`${GAME_SERVER_URL}/api/arena/status`)
        .then((r) => r.json())
        .then((status: Record<string, unknown>) => {
          if (status.state) setArenaState(status.state as ArenaState);
          if (status.roundNumber) setRoundNumber(status.roundNumber as number);
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
          case "arena_state_change": {
            setArenaState(data.state as ArenaState);
            break;
          }
          case "arena_betting_open": {
            setArenaState("betting");
            setRoundNumber(data.roundNumber as number);
            setBettingCountdown(data.secondsRemaining as number);
            setAgents(data.agents as ArenaAgentConfig[]);
            setGameState(null);
            setActions([]);
            setGameEnded(false);
            setGateFailedReason(null);
            setLastWinner(null);
            setPoolData({ totalPool: 0, agentPools: {} });
            break;
          }
          case "arena_betting_countdown": {
            setBettingCountdown(data.secondsRemaining as number);
            break;
          }
          case "arena_betting_locked": {
            setBettingCountdown(0);
            setArenaState("playing");
            break;
          }
          case "arena_pool_update": {
            setPoolData({
              totalPool: (data.totalPool as number) ?? 0,
              agentPools: (data.agentPools as Record<string, number>) ?? {},
            });
            break;
          }
          case "arena_gate_failed": {
            setGateFailedReason(data.reason as string);
            setBettingCountdown(null);
            break;
          }
          case "arena_game_complete": {
            setLastWinner({
              name: data.winnerName as string,
              index: data.winnerIndex as number,
              pot: data.pot as number,
            });
            setGameEnded(true);
            // Update virtual balances
            if (data.virtualBalances) {
              setAgents((prev) =>
                prev.map((a) => ({
                  ...a,
                  virtualBalance:
                    (data.virtualBalances as Record<string, number>)[a.pubkey] ??
                    a.virtualBalance,
                }))
              );
            }
            break;
          }
          case "arena_game_failed": {
            setGameEnded(true);
            break;
          }
          case "arena_cooldown": {
            setCooldownCountdown(data.secondsRemaining as number);
            break;
          }
          case "arena_error": {
            break;
          }
          // Also handle game_state/game_action/game_start/game_end from the game broadcast
          // (these come via the arena channel because ArenaManager subscribes game to arena channel too)
          case "game_state":
          case "game_action":
          case "game_start": {
            const adapted = adaptWsMessage(raw);
            if (adapted.gameState) {
              setGameState(adapted.gameState);
            }
            if (adapted.action) {
              setActions((prev) => [...prev.slice(-99), adapted.action!]);
            }
            if (type === "game_start") {
              setGameEnded(false);
            }
            break;
          }
          case "game_end": {
            const adapted = adaptWsMessage(raw);
            if (adapted.gameState) {
              setGameState(adapted.gameState);
            }
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
    gameState,
    actions,
    agents,
    bettingCountdown,
    cooldownCountdown,
    poolData,
    roundNumber,
    lastWinner,
    gameEnded,
    gateFailedReason,
    isConnected,
  };
}
