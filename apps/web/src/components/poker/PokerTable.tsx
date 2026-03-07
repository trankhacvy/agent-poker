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
  const players = gameState.players;

  function seatProps(index: number) {
    const player = players[index];
    return {
      player,
      isCurrentTurn: !winnerPublicKey && index === gameState.currentPlayerIndex,
      seatPosition: index,
      totalSeats: totalPlayers,
      showdownResult: getShowdownResult(player.publicKey),
      isWinner: winnerPublicKey === player.publicKey,
      latestAction: latestActions[player.publicKey],
    };
  }

  // Mobile row mapping: hexagonal → vertical
  // Seats: 0=bottom, 1=left, 2=top-left, 3=top, 4=top-right, 5=right
  // Top row: [3,4], Middle: [2,5], Bottom: [1,0]
  const mobileRows =
    totalPlayers >= 6
      ? [
          [3, 4],
          [2, 5],
          [1, 0],
        ]
      : totalPlayers >= 4
        ? [
            [2, 3],
            [1, 0],
          ]
        : [[1], [0]];

  return (
    <>
      {/* ═══════════ MOBILE LAYOUT ═══════════ */}
      <div className="md:hidden">
        <div className="relative rounded-2xl bg-[#0d1117] border border-white/10 overflow-hidden shadow-2xl">
          {/* Felt-like gradient background */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(26,42,26,0.4)_0%,_transparent_70%)]" />

          <div className="relative px-2 py-3 flex flex-col gap-2">
            {/* Status bar */}
            <div className="flex justify-between items-center px-1">
              <div className="px-2 py-0.5 bg-black/40 backdrop-blur-sm rounded-full text-[8px] font-semibold text-white/50">
                Blinds: {gameState.smallBlind}/{gameState.bigBlind}
              </div>
              {gameEnded ? (
                <div className="px-2 py-0.5 bg-black/40 backdrop-blur-sm rounded-full flex items-center gap-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="relative inline-flex h-full w-full rounded-full bg-[#fca311]" />
                  </span>
                  <span className="text-[8px] font-semibold text-[#fca311]/80">GAME OVER</span>
                </div>
              ) : (
                <div className="px-2 py-0.5 bg-black/40 backdrop-blur-sm rounded-full flex items-center gap-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-full w-full rounded-full bg-emerald-400" />
                  </span>
                  <span className="text-[8px] font-semibold text-emerald-400/80">LIVE</span>
                </div>
              )}
            </div>

            {/* Top row */}
            <div className="flex justify-around">
              {mobileRows[0].map(
                (idx) =>
                  players[idx] && (
                    <PlayerSeat key={players[idx].publicKey} inline {...seatProps(idx)} />
                  )
              )}
            </div>

            {/* Community Section */}
            <div className="flex flex-col items-center gap-1.5 py-1">
              {/* Pot */}
              <div className="flex flex-col items-center">
                <span className="text-[8px] font-bold text-white/40 tracking-widest uppercase">
                  Total Pot
                </span>
                <div className="flex items-center gap-1">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    className="flex-shrink-0"
                  >
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
                  <span className="text-sm font-bold text-[#fca311]">
                    {gameState.pot.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Community Cards */}
              <div className="flex gap-1">
                {gameState.communityCards.map((card, i) => (
                  <PlayingCard key={i} card={card} faceUp size="md" index={i} animateDeal />
                ))}
                {Array.from({ length: 5 - gameState.communityCards.length }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="w-9 h-[52px] rounded-lg border border-dashed border-white/10 bg-white/[0.02]"
                  />
                ))}
              </div>

              {/* Street label */}
              <span className="text-[10px] font-bold text-white/20 tracking-[0.2em] uppercase">
                {gameState.street}
              </span>
            </div>

            {/* Middle row */}
            <div className="flex justify-around">
              {mobileRows[1].map(
                (idx) =>
                  players[idx] && (
                    <PlayerSeat key={players[idx].publicKey} inline {...seatProps(idx)} />
                  )
              )}
            </div>

            {/* Bottom row */}
            {mobileRows[2] && (
              <div className="flex justify-around">
                {mobileRows[2].map(
                  (idx) =>
                    players[idx] && (
                      <PlayerSeat key={players[idx].publicKey} inline {...seatProps(idx)} />
                    )
                )}
              </div>
            )}
          </div>

          {/* Countdown overlay */}
          {gameEnded && nextGameCountdown != null && nextGameCountdown > 0 && (
            <div className="absolute bottom-2 right-2 z-20">
              <div className="px-2 py-1 bg-black/60 backdrop-blur-sm rounded-full">
                <span className="text-[8px] font-semibold text-[#fca311]">
                  Results {nextGameCountdown}s
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════ DESKTOP LAYOUT ═══════════ */}
      <div className="hidden md:block relative mx-auto aspect-16/10 w-full max-w-4xl select-none">
        <div className="absolute inset-0 rounded-3xl bg-[#0d1117] border border-white/10 shadow-2xl overflow-hidden">
          {/* Table background image */}
          <div className="absolute inset-0 overflow-hidden rounded-3xl">
            <img src="/table.png" alt="" className="w-full h-full object-fill" />
          </div>

          {/* The Felt Table */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[82%] h-[62%]">
            <div className="w-full h-full rounded-[200px] relative">
              {/* Pot display */}
              <div className="absolute top-[22%] left-1/2 -translate-x-1/2 flex flex-col items-center z-10">
                <span className="text-[10px] font-bold text-white/40 tracking-widest uppercase">
                  Total Pot
                </span>
                <div className="flex items-center gap-1">
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
              {players.map((player, i) => (
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
              <div className="px-3 py-1 bg-black/40 backdrop-blur-sm rounded-full flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex h-full w-full rounded-full bg-[#fca311]" />
                </span>
                <span className="text-[10px] font-semibold text-[#fca311]/80">GAME OVER</span>
              </div>
            ) : (
              <div className="px-3 py-1 bg-black/40 backdrop-blur-sm rounded-full flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-full w-full rounded-full bg-emerald-400" />
                </span>
                <span className="text-[10px] font-semibold text-emerald-400/80">LIVE</span>
              </div>
            )}
          </div>

          {/* Results countdown overlay */}
          {gameEnded && nextGameCountdown != null && nextGameCountdown > 0 && (
            <div className="absolute bottom-4 right-4 z-20">
              <div className="px-3 py-1.5 bg-black/60 backdrop-blur-sm rounded-full flex items-center gap-1">
                <span className="text-[10px] font-semibold text-[#fca311]">
                  Results {nextGameCountdown}s
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
