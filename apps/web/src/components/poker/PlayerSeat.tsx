"use client";

import { useState } from "react";
import type { PlayerSnapshot, ShowdownResult, GameAction } from "@/lib/types";
import { TEMPLATES } from "@/lib/constants";
import PlayingCard from "./PlayingCard";

interface PlayerSeatProps {
  player: PlayerSnapshot;
  isCurrentTurn: boolean;
  seatPosition: number;
  totalSeats: number;
  showdownResult?: ShowdownResult;
  isWinner?: boolean;
  latestAction?: GameAction;
}

const templateEmojis = ["\u{1F988}", "\u{1F525}", "\u{1FAA8}", "\u{1F98A}"];

// ── Seat Layouts ────────────────────────────────────────────────────────────
// `infoPos`: "below" → name+balance extend downward (bottom/side seats)
//            "above" → name+balance extend upward   (top seats)
interface SeatDef {
  x: string;
  y: string;
  infoPos: "above" | "below";
}

const SEAT_LAYOUTS: Record<number, SeatDef[]> = {
  2: [
    { x: "50%", y: "102%", infoPos: "below" },
    { x: "50%", y: "-2%", infoPos: "above" },
  ],
  3: [
    { x: "50%", y: "102%", infoPos: "below" },
    { x: "8%", y: "20%", infoPos: "above" },
    { x: "92%", y: "20%", infoPos: "above" },
  ],
  4: [
    { x: "50%", y: "102%", infoPos: "below" },
    { x: "3%", y: "50%", infoPos: "below" },
    { x: "50%", y: "-2%", infoPos: "above" },
    { x: "97%", y: "50%", infoPos: "below" },
  ],
  5: [
    { x: "50%", y: "102%", infoPos: "below" },
    { x: "3%", y: "65%", infoPos: "below" },
    { x: "12%", y: "8%", infoPos: "above" },
    { x: "88%", y: "8%", infoPos: "above" },
    { x: "97%", y: "65%", infoPos: "below" },
  ],
  6: [
    { x: "50%", y: "100%", infoPos: "below" },
    { x: "-2%", y: "60%", infoPos: "below" },
    { x: "10%", y: "-5%", infoPos: "above" },
    { x: "50%", y: "-10%", infoPos: "above" },
    { x: "90%", y: "-5%", infoPos: "above" },
    { x: "102%", y: "60%", infoPos: "below" },
  ],
};

function getSeatPosition(index: number, total: number): SeatDef {
  const layout = SEAT_LAYOUTS[total] ?? SEAT_LAYOUTS[6];
  return layout[index % layout.length];
}

// ── Action Popup ────────────────────────────────────────────────────────────

const actionStyles: Record<string, string> = {
  fold: "bg-gray-600 text-white",
  check: "bg-blue-500 text-white",
  call: "bg-green-500 text-white",
  raise: "bg-amber-500 text-white",
  "all-in": "bg-red-500 text-white",
  "post-blind": "bg-violet-500 text-white",
  deal: "bg-cyan-500 text-white",
};

function actionLabel(action: GameAction): string {
  switch (action.actionType) {
    case "fold":
      return "FOLD";
    case "check":
      return "CHECK";
    case "call":
      return action.amount > 0 ? `CALL ${action.amount}` : "CALL";
    case "raise":
      return `RAISE ${action.amount}`;
    case "all-in":
      return "ALL IN";
    case "post-blind":
      return `BLIND ${action.amount}`;
    default:
      return action.actionType.toUpperCase();
  }
}

function ActionPopup({ action }: { action: GameAction }) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  const style = actionStyles[action.actionType] ?? "bg-gray-600 text-white";

  return (
    <div
      key={action.id}
      className={`absolute -top-8 left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded-full text-[10px] font-bold whitespace-nowrap shadow-lg ${style}`}
      style={{ animation: "action-popup 2.5s ease-out forwards" }}
      onAnimationEnd={() => setVisible(false)}
    >
      {actionLabel(action)}
    </div>
  );
}

// ── SOL Icon ────────────────────────────────────────────────────────────────

function SolIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`w-3 h-3 ${className}`} fill="none">
      <path
        d="M4 17.5h14.5l-3 3.5H1.5l2.5-3.5ZM4 10.25h14.5l-3 3.5H1.5l2.5-3.5ZM18.5 6.5H4L7 3h14l-2.5 3.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function PlayerSeat({
  player,
  isCurrentTurn,
  seatPosition,
  totalSeats,
  showdownResult,
  isWinner = false,
  latestAction,
}: PlayerSeatProps) {
  const template = TEMPLATES[player.templateId];
  const isFolded = player.status === "folded";
  const isAllIn = player.status === "all-in";
  const showCards = showdownResult && !isFolded;
  const templateColor = template?.color ?? "#6B7280";

  const pos = getSeatPosition(seatPosition, totalSeats);
  const infoAbove = pos.infoPos === "above";

  // ── Avatar border/glow ────────────────────────────────────────────────

  const avatarBorder = isWinner
    ? "#fca311"
    : isCurrentTurn
      ? templateColor
      : "rgba(255,255,255,0.08)";

  const avatarBorderWidth = isWinner ? "3px" : isCurrentTurn ? "3px" : "2px";

  const avatarGlow: React.CSSProperties = isWinner
    ? {
        animation: "pulse-gold 2s infinite",
        boxShadow: `0 0 30px 8px rgba(252,163,17,0.6), 0 0 60px 16px rgba(252,163,17,0.2), inset 0 0 15px rgba(252,163,17,0.1)`,
      }
    : isCurrentTurn
      ? {
          animation: "glow-pulse 2s infinite",
          "--glow-color": templateColor,
          boxShadow: `0 0 16px 4px ${templateColor}66, 0 0 32px 8px ${templateColor}22`,
        } as React.CSSProperties
      : {};

  // ── Sub-blocks ────────────────────────────────────────────────────────

  const avatarBlock = (
    <div className="relative">
      {/* Action popup */}
      {latestAction && <ActionPopup action={latestAction} />}

      {/* Avatar frame */}
      <div
        className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 ${
          isFolded ? "opacity-40 grayscale" : ""
        }`}
        style={{
          background: "#1a1f2e",
          border: `${avatarBorderWidth} solid ${avatarBorder}`,
          ...avatarGlow,
        }}
      >
        <span className="text-xl select-none">{templateEmojis[player.templateId]}</span>

        {/* Winner crown - overlaid centered on top of avatar */}
        {isWinner && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-base z-20 drop-shadow-[0_0_8px_rgba(252,163,17,0.8)]">
            {"\u{1F451}"}
          </div>
        )}

        {/* Dealer badge */}
        {player.isDealer && (
          <div className="absolute -right-1.5 -top-1.5 w-5 h-5 rounded-full bg-white text-[#161d26] text-[8px] font-bold flex items-center justify-center shadow-md z-10">
            D
          </div>
        )}

        {/* ALL IN badge */}
        {isAllIn && (
          <div
            className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[7px] font-bold text-red-300 bg-red-500/30 border border-red-500/40 whitespace-nowrap z-10"
            style={{ animation: "allin-pulse 2s infinite" }}
          >
            ALL IN
          </div>
        )}

        {/* FOLD badge */}
        {isFolded && (
          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[7px] font-bold text-zinc-400 bg-zinc-600/60 border border-zinc-500/30 whitespace-nowrap z-10">
            FOLD
          </div>
        )}
      </div>

    </div>
  );

  const infoBlock = (
    <div className="flex flex-col items-center gap-0.5">
      {/* Name pill */}
      <div
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 backdrop-blur-sm border ${
          isWinner
            ? "bg-[#fca311]/15 border-[#fca311]/40"
            : isCurrentTurn
              ? "bg-[#1a1f2e]/95 border-white/20"
              : isFolded
                ? "bg-[#1a1f2e]/60 border-white/5"
                : "bg-[#1a1f2e]/90 border-white/8"
        }`}
      >
        {isWinner ? (
          <span className="text-[8px] font-black text-[#fca311] tracking-wider">WIN</span>
        ) : (
          <span className="text-[9px] font-bold text-white/25 tabular-nums">
            {player.seatIndex + 1}
          </span>
        )}
        <span
          className={`text-[11px] font-bold truncate max-w-[72px] ${
            isWinner
              ? "text-[#fca311]"
              : isFolded
                ? "text-zinc-500"
                : "text-white/80"
          }`}
        >
          {player.displayName}
        </span>
      </div>
      {/* Balance */}
      <div className="flex items-center gap-1">
        <SolIcon className={isWinner ? "text-[#fca311]" : "text-purple-400"} />
        <span
          className={`text-[11px] font-bold tabular-nums ${
            isWinner ? "text-[#fca311]" : "text-white/60"
          }`}
        >
          {player.chips.toLocaleString()}
        </span>
      </div>
    </div>
  );

  const cardsBlock = (
    <div className={`flex -space-x-2 ${isFolded ? "opacity-30" : ""}`}>
      {showCards
        ? showdownResult.cards.map((card, i) => (
            <div key={i} className="transform hover:-translate-y-1 transition-transform">
              <PlayingCard card={card} faceUp size="sm" />
            </div>
          ))
        : player.cards.map((card, i) => (
            <div key={i} className="transform hover:-translate-y-1 transition-transform">
              <PlayingCard card={card} faceUp={!isFolded && card >= 0} size="sm" />
            </div>
          ))}
    </div>
  );

  const handNameBlock = showdownResult && !isFolded && (
    <div
      className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${
        showdownResult.isWinner
          ? "bg-[#fca311]/20 text-[#fca311]"
          : "bg-white/5 text-zinc-400"
      }`}
    >
      {showdownResult.handName}
    </div>
  );

  const betBlock = player.currentBet > 0 && !isFolded && (
    <div className="flex items-center gap-1">
      <div className="w-3.5 h-3.5 rounded-full bg-[#fca311] border-2 border-[#1a1f2e] flex items-center justify-center shadow">
        <span className="text-[5px] font-bold text-[#161d26]">$</span>
      </div>
      <span className="text-[10px] font-medium text-[#fca311]">
        {player.currentBet}
      </span>
    </div>
  );

  // ── Layout logic ──────────────────────────────────────────────────────
  //
  // Bottom seats: cards → avatar → name → balance  (cards face table center)
  // Top seats:    balance → name → avatar → cards   (cards face table center)
  //

  return (
    <div
      className="absolute flex flex-col items-center z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="flex flex-col items-center gap-1">
        {infoAbove ? (
          <>
            {/* Top seat: info on top, avatar middle, cards toward center (bottom) */}
            {infoBlock}
            {avatarBlock}
            <div className="flex flex-col items-center gap-0.5">
              {cardsBlock}
              {handNameBlock}
              {betBlock}
            </div>
          </>
        ) : (
          <>
            {/* Bottom seat: cards toward center (top), avatar middle, info at bottom */}
            <div className="flex flex-col items-center gap-0.5">
              {cardsBlock}
              {handNameBlock}
              {betBlock}
            </div>
            {avatarBlock}
            {infoBlock}
          </>
        )}
      </div>
    </div>
  );
}
