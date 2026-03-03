"use client";

import { use, useEffect, useMemo, useState } from "react";
import { LazyMotion, domAnimation, m } from "motion/react";
import type {
  GameStateSnapshot,
  GameAction,
  GamePhase,
  GameResult,
  ShowdownResult,
  TableInfo,
} from "@/lib/types";
import { useGameWebSocket } from "@/hooks/useGameWebSocket";
import { fetchTable, fetchBettingPool } from "@/lib/api";
import PokerTable from "@/components/poker/PokerTable";
import ActionFeed from "@/components/poker/ActionFeed";
import BettingPanel from "@/components/betting/BettingPanel";

function deriveGamePhase(state: GameStateSnapshot): GamePhase {
  if (state.isShowdown) return "showdown";
  if (state.street === "showdown") return "showdown";
  return "playing";
}

interface TablePageProps {
  params: Promise<{ tableId: string }>;
}

export default function TablePage({ params }: TablePageProps) {
  const { tableId } = use(params);
  const {
    gameState,
    actions,
    bettingCountdown,
    bettingLocked,
    isConnected,
    poolData: wsPoolData,
    subscribe,
    unsubscribe,
  } = useGameWebSocket();
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [gamePhase, setGamePhase] = useState<GamePhase>("waiting");
  const [tableWagerTier, setTableWagerTier] = useState<number | null>(null);
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);
  const [poolTotal, setPoolTotal] = useState(0);
  const [agentPools, setAgentPools] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchTable(tableId).then((t) => {
      if (t) {
        setTableWagerTier(t.wagerTierIndex);
        setTableInfo(t);
      }
    });
    fetchBettingPool(tableId).then((pool) => {
      setPoolTotal(pool.totalPool);
      setAgentPools(pool.agentPools);
    });
  }, [tableId]);

  useEffect(() => {
    if (wsPoolData) {
      setPoolTotal(wsPoolData.totalPool);
      setAgentPools(wsPoolData.agentPools);
    }
  }, [wsPoolData]);

  useEffect(() => {
    subscribe(tableId);
    return () => unsubscribe(tableId);
  }, [tableId, subscribe, unsubscribe]);

  const displayState = gameState;
  const displayActions = actions;

  useEffect(() => {
    if (!displayState) {
      if (!bettingLocked) {
        setGamePhase("waiting");
      }
      return;
    }

    const phase = deriveGamePhase(displayState);
    setGamePhase(phase);

    if (phase === "showdown" && !gameResult) {
      const activePlayers = displayState.players.filter(
        (p) => p.status !== "folded"
      );

      const winnerIdx = displayState.winnerIndex;

      const showdownResults: ShowdownResult[] = activePlayers.map((p) => ({
        publicKey: p.publicKey,
        displayName: p.displayName,
        cards: p.cards[0] >= 0 ? p.cards : [],
        handName: "",
        isWinner: winnerIdx !== undefined ? p.seatIndex === winnerIdx : false,
      }));

      const winner = showdownResults.find((r) => r.isWinner) ?? showdownResults[0];
      if (winner) {
        const result: GameResult = {
          winnerPublicKey: winner.publicKey,
          winnerName: winner.displayName,
          potAmount: displayState.pot,
          showdownResults,
        };

        const timer = setTimeout(() => {
          setGameResult(result);
          setGamePhase("complete");
        }, 3000);

        return () => clearTimeout(timer);
      }
    }
  }, [displayState, gameResult, bettingLocked]);

  const showdownResults = useMemo(() => {
    if (gamePhase === "showdown" || gamePhase === "complete") {
      return gameResult?.showdownResults;
    }
    return undefined;
  }, [gamePhase, gameResult]);

  const winnerPublicKey = useMemo(() => {
    if (gamePhase === "complete" || gamePhase === "showdown") {
      return gameResult?.winnerPublicKey;
    }
    return undefined;
  }, [gamePhase, gameResult]);

  return (
    <LazyMotion features={domAnimation}>
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Table {tableId.slice(0, 8)}...
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-primary" : "bg-destructive"}`}
              />
              <span className="text-sm text-muted-foreground">
                {isConnected ? "Live" : "Connecting..."}
              </span>
              {bettingCountdown !== null && bettingCountdown > 0 && (
                <span className="ml-2 text-sm font-medium text-secondary">
                  Betting: {bettingCountdown}s
                </span>
              )}
              {bettingLocked && (
                <span className="ml-2 text-sm font-medium text-destructive">
                  Betting Locked
                </span>
              )}
            </div>
          </div>
        </div>

        {gamePhase === "waiting" && !displayState && (
          <div className="mb-6 flex flex-col items-center gap-2 border-2 border-border bg-card px-6 py-10">
            {tableInfo?.status === "settled" ? (
              <>
                <span className="text-lg font-bold text-secondary">Game Settled</span>
                <div className="mt-4 w-full max-w-md space-y-2">
                  {tableInfo.players.map((p, i) => (
                    <div
                      key={p.pubkey + i}
                      className="flex items-center justify-between border-2 border-border bg-muted px-4 py-2"
                    >
                      <div>
                        <span className="font-medium text-foreground">{p.displayName}</span>
                        <span className="ml-2 text-xs text-muted-foreground">Seat {p.seatIndex}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {p.pubkey.slice(0, 4)}..{p.pubkey.slice(-4)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <span className="text-muted-foreground">
                {bettingCountdown !== null
                  ? `Betting window open — ${bettingCountdown}s remaining`
                  : "Waiting for game to start..."}
              </span>
            )}
          </div>
        )}

        {gamePhase === "complete" && gameResult && (
          <m.div
            initial={{ opacity: 0, scale: 0.8, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, type: "spring" }}
            className="mb-6 flex flex-col items-center gap-2 border-2 border-secondary bg-secondary/10 px-6 py-5"
          >
            <m.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="text-5xl"
            >
              {"\u{1F3C6}"}
            </m.div>
            <m.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-xl font-bold text-secondary"
            >
              {gameResult.winnerName} wins{" "}
              {gameResult.potAmount.toLocaleString()} chips!
            </m.p>
            <m.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="text-sm text-muted-foreground"
            >
              Pot collected by the winner
            </m.div>
          </m.div>
        )}

        {displayState && (
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="flex flex-col gap-6">
              <PokerTable
                gameState={displayState}
                showdownResults={showdownResults}
                winnerPublicKey={winnerPublicKey}
                actions={displayActions}
              />
              <ActionFeed actions={displayActions} />
            </div>

            <div>
              <BettingPanel
                tableId={tableId}
                players={displayState.players}
                poolTotal={poolTotal}
                agentPools={agentPools}
                gamePhase={gamePhase}
                winnerPublicKey={winnerPublicKey}
                bettingCountdown={bettingCountdown}
                bettingLocked={bettingLocked}
              />
            </div>
          </div>
        )}
      </div>
    </LazyMotion>
  );
}
