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
import { fetchTable } from "@/lib/api";
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
    subscribe,
    unsubscribe,
  } = useGameWebSocket();
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [gamePhase, setGamePhase] = useState<GamePhase>("waiting");
  const [tableWagerTier, setTableWagerTier] = useState<number | null>(null);
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null);

  useEffect(() => {
    fetchTable(tableId).then((t) => {
      if (t) {
        setTableWagerTier(t.wagerTierIndex);
        setTableInfo(t);
      }
    });
  }, [tableId]);

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

      const handNames = [
        "High Card",
        "Pair",
        "Two Pair",
        "Three of a Kind",
        "Straight",
        "Flush",
        "Full House",
        "Four of a Kind",
        "Straight Flush",
        "Royal Flush",
      ];

      const showdownResults: ShowdownResult[] = activePlayers.map((p, idx) => ({
        publicKey: p.publicKey,
        displayName: p.displayName,
        cards: p.cards[0] >= 0 ? p.cards : [idx * 2, idx * 2 + 13],
        handName: handNames[Math.min(idx + 3, handNames.length - 1)],
        isWinner: idx === 0,
      }));

      const winner = activePlayers[0];
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
            <h1 className="text-2xl font-bold text-zinc-100">
              Table {tableId.slice(0, 8)}...
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-emerald-400" : "bg-red-400"}`}
              />
              <span className="text-sm text-zinc-500">
                {isConnected ? "Live" : "Connecting..."}
              </span>
              {bettingCountdown !== null && bettingCountdown > 0 && (
                <span className="ml-2 text-sm font-medium text-amber-400">
                  Betting: {bettingCountdown}s
                </span>
              )}
              {bettingLocked && (
                <span className="ml-2 text-sm font-medium text-red-400">
                  Betting Locked
                </span>
              )}
            </div>
          </div>
        </div>

        {gamePhase === "waiting" && !displayState && (
          <div className="mb-6 flex flex-col items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/50 px-6 py-10">
            {tableInfo?.status === "settled" ? (
              <>
                <span className="text-lg font-bold text-amber-400">Game Settled</span>
                <div className="mt-4 w-full max-w-md space-y-2">
                  {tableInfo.players.map((p, i) => (
                    <div
                      key={p.pubkey + i}
                      className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-2"
                    >
                      <div>
                        <span className="font-medium text-zinc-200">{p.displayName}</span>
                        <span className="ml-2 text-xs text-zinc-500">Seat {p.seatIndex}</span>
                      </div>
                      <span className="text-xs text-zinc-500">
                        {p.pubkey.slice(0, 4)}..{p.pubkey.slice(-4)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <span className="text-zinc-500">
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
            className="mb-6 flex flex-col items-center gap-2 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-900/20 via-amber-800/30 to-amber-900/20 px-6 py-5"
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
              className="text-xl font-bold text-amber-400"
            >
              {gameResult.winnerName} wins{" "}
              {gameResult.potAmount.toLocaleString()} chips!
            </m.p>
            <m.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="text-sm text-zinc-400"
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
              />
              <ActionFeed actions={displayActions} />
            </div>

            <div>
              <BettingPanel
                players={displayState.players}
                poolTotal={0}
                agentPools={{}}
                gamePhase={gamePhase}
                winnerPublicKey={winnerPublicKey}
                bettingDeadline={
                  bettingCountdown !== null && bettingCountdown > 0
                    ? Date.now() + bettingCountdown * 1000
                    : undefined
                }
              />
            </div>
          </div>
        )}
      </div>
    </LazyMotion>
  );
}
