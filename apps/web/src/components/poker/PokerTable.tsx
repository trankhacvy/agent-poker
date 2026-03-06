"use client";

import { useMemo } from "react";
import type { GameStateSnapshot, ShowdownResult, GameAction } from "@/lib/types";
import PlayerSeat from "./PlayerSeat";
import PlayingCard from "./PlayingCard";

interface PokerTableProps {
  gameState: GameStateSnapshot;
  showdownResults?: ShowdownResult[];
  winnerPublicKey?: string;
  actions?: GameAction[];
  gameEnded?: boolean;
  nextGameCountdown?: number | null;
}

export default function PokerTable({
  gameState,
  showdownResults,
  winnerPublicKey,
  actions,
  gameEnded,
  nextGameCountdown,
}: PokerTableProps) {
  function getShowdownResult(publicKey: string): ShowdownResult | undefined {
    return showdownResults?.find((r) => r.publicKey === publicKey);
  }

  const latestActions = useMemo(() => {
    const map: Record<string, GameAction> = {};
    const recent = (actions ?? []).slice(-10);
    for (const action of recent) {
      map[action.playerPublicKey] = action;
    }
    return map;
  }, [actions]);

  const totalPlayers = gameState.players.length;

  return (
    <div className="relative mx-auto aspect-16/10 w-full max-w-4xl select-none">
      {/* Outer container (dark background frame) */}
      <div className="absolute inset-0 rounded-3xl bg-[#0d1117] border shadow-2xl overflow-hidden">
        {/* Table background image */}
        <div className="absolute inset-0 overflow-hidden rounded-3xl">
          <img src="/table.png" alt="" className="w-full h-full object-fill" />
        </div>

        {/* The Felt Table (positioned over the image) */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[82%] h-[62%]">
          <div className="w-full h-full rounded-[200px] relative">
            {/* Pot display */}
            <div className="absolute top-[22%] left-1/2 -translate-x-1/2 flex flex-col items-center z-10">
              <span className="text-[10px] font-bold text-white/40 tracking-widest uppercase">
                Total Pot
              </span>
              <div className="flex items-center gap-1.5">
                {/* Chip icon */}
                <svg width="16" height="16" viewBox="0 0 16 16" className="flex-shrink-0">
                  <circle cx="8" cy="8" r="7" fill="#fca311" stroke="#b47a0a" strokeWidth="1" />
                  <circle
                    cx="8"
                    cy="8"
                    r="4.5"
                    fill="none"
                    stroke="#b47a0a"
                    strokeWidth="0.8"
                    strokeDasharray="2 1.5"
                  />
                </svg>
                <span className="text-lg font-bold text-[#fca311]">
                  {gameState.pot.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Community Cards */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-1">
              {gameState.communityCards.map((card, i) => (
                <PlayingCard key={i} card={card} faceUp size="lg" index={i} animateDeal />
              ))}
              {Array.from({ length: 5 - gameState.communityCards.length }).map((_, i) => (
                <div
                  key={`empty-${i}`}
                  className="w-[60px] h-[84px] rounded-lg border border-dashed border-white/10 bg-white/[0.02]"
                />
              ))}
            </div>

            {/* Street label */}
            <div className="absolute bottom-[27%] left-1/2 -translate-x-1/2">
              <span className="text-[10px] font-bold text-white/20 tracking-[0.2em] uppercase">
                {gameState.street}
              </span>
            </div>

            {/* Player seats */}
            {gameState.players.map((player, i) => (
              <PlayerSeat
                key={player.publicKey}
                player={player}
                isCurrentTurn={!winnerPublicKey && i === gameState.currentPlayerIndex}
                seatPosition={i}
                totalSeats={totalPlayers}
                showdownResult={getShowdownResult(player.publicKey)}
                isWinner={winnerPublicKey === player.publicKey}
                latestAction={latestActions[player.publicKey]}
              />
            ))}
          </div>
        </div>

        {/* Blind info badge */}
        <div className="absolute top-4 left-4 flex items-center gap-2 z-20">
          <div className="px-3 py-1 bg-black/40 backdrop-blur-sm rounded-full text-[10px] font-semibold text-white/50">
            Blinds: {gameState.smallBlind}/{gameState.bigBlind}
          </div>
        </div>

        {/* Connection indicator */}
        <div className="absolute top-4 right-4 flex items-center gap-2 z-20">
          {gameEnded ? (
            <div className="px-3 py-1 bg-black/40 backdrop-blur-sm rounded-full flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#fca311]" />
              </span>
              <span className="text-[10px] font-semibold text-[#fca311]/80">GAME OVER</span>
            </div>
          ) : (
            <div className="px-3 py-1 bg-black/40 backdrop-blur-sm rounded-full flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[10px] font-semibold text-emerald-400/80">LIVE</span>
            </div>
          )}
        </div>

        {/* Results countdown overlay */}
        {gameEnded && nextGameCountdown != null && nextGameCountdown > 0 && (
          <div className="absolute bottom-4 right-4 z-20">
            <div className="px-3 py-1.5 bg-black/60 backdrop-blur-sm rounded-full flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-[#fca311]">
                Results {nextGameCountdown}s
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
