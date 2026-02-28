"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameStateSnapshot, GameAction } from "@/lib/types";
import { GAME_SERVER_WS_URL } from "@/lib/constants";
import { adaptWsMessage } from "@/lib/adapters";

interface UseGameWebSocketReturn {
  gameState: GameStateSnapshot | null;
  actions: GameAction[];
  bettingCountdown: number | null;
  bettingLocked: boolean;
  isConnected: boolean;
  subscribe: (tableId: string) => void;
  unsubscribe: (tableId: string) => void;
}

export function useGameWebSocket(): UseGameWebSocketReturn {
  const [gameState, setGameState] = useState<GameStateSnapshot | null>(null);
  const [actions, setActions] = useState<GameAction[]>([]);
  const [bettingCountdown, setBettingCountdown] = useState<number | null>(null);
  const [bettingLocked, setBettingLocked] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribedTableRef = useRef<string | null>(null);
  const subscribedGameRef = useRef<string | null>(null);

  const sendJson = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(GAME_SERVER_WS_URL);

    ws.onopen = () => {
      setIsConnected(true);
      if (subscribedTableRef.current) {
        ws.send(
          JSON.stringify({ type: "subscribe", tableId: subscribedTableRef.current })
        );
      }
      if (subscribedGameRef.current) {
        ws.send(
          JSON.stringify({ type: "subscribe", gameId: subscribedGameRef.current })
        );
      }
    };

    ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data as string);
        const msg = adaptWsMessage(raw);

        switch (msg.type) {
          case "game_state":
          case "game_action":
          case "game_start": {
            if (msg.gameState) {
              setGameState(msg.gameState);
            }
            if (msg.action) {
              setActions((prev) => [...prev.slice(-99), msg.action!]);
            }
            if (msg.type === "game_start" && msg.gameId && msg.gameId !== subscribedGameRef.current) {
              subscribedGameRef.current = msg.gameId;
              ws.send(JSON.stringify({ type: "subscribe", gameId: msg.gameId }));
            }
            break;
          }
          case "game_end": {
            if (msg.gameState) {
              setGameState(msg.gameState);
            }
            break;
          }
          case "betting_countdown": {
            if (msg.bettingCountdown) {
              setBettingCountdown(msg.bettingCountdown.secondsRemaining);
            }
            break;
          }
          case "betting_locked": {
            setBettingCountdown(0);
            setBettingLocked(true);
            break;
          }
          case "subscribe_ack":
          case "error":
            break;
        }
      } catch {}
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

  const subscribe = useCallback(
    (tableId: string) => {
      subscribedTableRef.current = tableId;
      subscribedGameRef.current = null;
      setActions([]);
      setGameState(null);
      setBettingCountdown(null);
      setBettingLocked(false);
      sendJson({ type: "subscribe", tableId });
    },
    [sendJson]
  );

  const unsubscribe = useCallback(
    (tableId: string) => {
      sendJson({ type: "unsubscribe", tableId });
      if (subscribedGameRef.current) {
        sendJson({ type: "unsubscribe", gameId: subscribedGameRef.current });
      }
      subscribedTableRef.current = null;
      subscribedGameRef.current = null;
    },
    [sendJson]
  );

  return {
    gameState,
    actions,
    bettingCountdown,
    bettingLocked,
    isConnected,
    subscribe,
    unsubscribe,
  };
}
