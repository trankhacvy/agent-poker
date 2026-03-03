"use client";

import type { GameStateSnapshot, ShowdownResult } from "@/lib/types";
import PlayerSeat from "./PlayerSeat";
import PlayingCard from "./PlayingCard";

interface PokerTableProps {
  gameState: GameStateSnapshot;
  showdownResults?: ShowdownResult[];
  winnerPublicKey?: string;
}

export default function PokerTable({
  gameState,
  showdownResults,
  winnerPublicKey,
}: PokerTableProps) {
  function getShowdownResult(publicKey: string): ShowdownResult | undefined {
    return showdownResults?.find((r) => r.publicKey === publicKey);
  }

  const totalPlayers = gameState.players.length;

  return (
    <div className="relative mx-auto aspect-[16/10] w-full max-w-4xl select-none">
      {/* Outer container (dark background frame) */}
      <div className="absolute inset-0 rounded-3xl bg-[#161d26] border border-white/5 shadow-2xl overflow-hidden">
        {/* The Felt Table */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[82%] h-[62%]">
          <div className="w-full h-full bg-[#1b2531] rounded-[200px] border-[10px] border-[#232f3e] shadow-inner relative">
            {/* Subtle radial glow on the felt */}
            <div className="absolute inset-0 rounded-[190px] bg-[radial-gradient(ellipse_at_center,rgba(100,210,208,0.04)_0%,transparent_70%)]" />

            {/* Pot display */}
            <div className="absolute top-[22%] left-1/2 -translate-x-1/2 flex flex-col items-center z-10">
              <span className="text-[10px] font-bold text-white/40 tracking-widest uppercase">
                Total Pot
              </span>
              <span className="text-lg font-bold text-[#64d2d0]">
                {gameState.pot.toLocaleString()}
              </span>
            </div>

            {/* Community Cards */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-1.5 mt-2">
              {gameState.communityCards.map((card, i) => (
                <PlayingCard key={i} card={card} faceUp size="lg" />
              ))}
              {Array.from({ length: 5 - gameState.communityCards.length }).map(
                (_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="w-[4.5rem] h-[6.25rem] rounded-lg border border-dashed border-white/10 bg-white/[0.02]"
                  />
                )
              )}
            </div>

            {/* Street label */}
            <div className="absolute bottom-[22%] left-1/2 -translate-x-1/2">
              <span className="text-[10px] font-bold text-white/20 tracking-[0.2em] uppercase">
                {gameState.street}
              </span>
            </div>

            {/* Player seats */}
            {gameState.players.map((player, i) => (
              <PlayerSeat
                key={player.publicKey}
                player={player}
                isCurrentTurn={i === gameState.currentPlayerIndex}
                seatPosition={i}
                totalSeats={totalPlayers}
                showdownResult={getShowdownResult(player.publicKey)}
                isWinner={winnerPublicKey === player.publicKey}
              />
            ))}
          </div>
        </div>

        {/* Blind info badge */}
        <div className="absolute top-4 left-4 flex items-center gap-2 z-20">
          <div className="px-3 py-1.5 bg-[#232f3e] rounded-lg text-[10px] font-semibold text-white/40">
            Blinds: {gameState.smallBlind}/{gameState.bigBlind}
          </div>
        </div>

        {/* Connection indicator */}
        <div className="absolute top-4 right-4 flex items-center gap-2 z-20">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[10px] font-semibold text-emerald-400/60">LIVE</span>
        </div>
      </div>
    </div>
  );
}
