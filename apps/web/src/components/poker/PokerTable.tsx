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

  return (
    <div className="relative mx-auto aspect-[16/10] w-full max-w-4xl">
      <div className="absolute inset-0 rounded-[50%] border-4 border-amber-900/60 bg-gradient-to-br from-emerald-900 to-emerald-950 shadow-2xl shadow-black/50">
        <div className="absolute inset-3 rounded-[50%] border-2 border-emerald-700/40" />

        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
          <div className="flex gap-1.5">
            {gameState.communityCards.map((card, i) => (
              <PlayingCard key={i} card={card} faceUp />
            ))}
            {Array.from({ length: 5 - gameState.communityCards.length }).map(
              (_, i) => (
                <div
                  key={`empty-${i}`}
                  className="h-20 w-14 rounded-lg border border-dashed border-emerald-700/30"
                />
              )
            )}
          </div>

          <div className="rounded-full bg-black/40 px-4 py-1.5 backdrop-blur-sm">
            <span className="text-sm text-zinc-400">Pot: </span>
            <span className="text-lg font-bold text-amber-400">
              {gameState.pot.toLocaleString()}
            </span>
          </div>

          <div className="text-xs font-medium uppercase tracking-wider text-emerald-500/60">
            {gameState.street}
          </div>
        </div>
      </div>

      {gameState.players.map((player, i) => (
        <PlayerSeat
          key={player.publicKey}
          player={player}
          isCurrentTurn={i === gameState.currentPlayerIndex}
          seatPosition={i}
          showdownResult={getShowdownResult(player.publicKey)}
          isWinner={winnerPublicKey === player.publicKey}
        />
      ))}
    </div>
  );
}
