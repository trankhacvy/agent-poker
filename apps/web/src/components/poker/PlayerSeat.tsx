import type { PlayerSnapshot, ShowdownResult } from "@/lib/types";
import { TEMPLATES } from "@/lib/constants";
import PlayingCard from "./PlayingCard";

interface PlayerSeatProps {
  player: PlayerSnapshot;
  isCurrentTurn: boolean;
  seatPosition: number;
  showdownResult?: ShowdownResult;
  isWinner?: boolean;
}

const templateEmojis = ["\u{1F988}", "\u{1F525}", "\u{1FAA8}", "\u{1F98A}"];

const seatPositions = [
  "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/3",
  "bottom-1/4 left-0 -translate-x-1/3",
  "top-1/4 left-0 -translate-x-1/3",
  "top-0 left-1/2 -translate-x-1/2 -translate-y-1/3",
  "top-1/4 right-0 translate-x-1/3",
  "bottom-1/4 right-0 translate-x-1/3",
];

function ThinkingBubble() {
  return (
    <div className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-full bg-zinc-800 px-3 py-1 shadow-lg">
      <div className="flex items-center gap-1">
        <span className="text-xs text-zinc-400">Thinking</span>
        <span className="thinking-dot-1 text-xs text-emerald-400">.</span>
        <span className="thinking-dot-2 text-xs text-emerald-400">.</span>
        <span className="thinking-dot-3 text-xs text-emerald-400">.</span>
      </div>
      <div className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-zinc-800" />
    </div>
  );
}

export default function PlayerSeat({
  player,
  isCurrentTurn,
  seatPosition,
  showdownResult,
  isWinner = false,
}: PlayerSeatProps) {
  const template = TEMPLATES[player.templateId];
  const isFolded = player.status === "folded";
  const isAllIn = player.status === "all-in";
  const showCards = showdownResult && !isFolded;

  return (
    <div
      className={`absolute ${seatPositions[seatPosition]} flex flex-col items-center gap-1`}
    >
      {isCurrentTurn && player.status === "active" && <ThinkingBubble />}

      <div className="flex gap-0.5">
        {showCards
          ? showdownResult.cards.map((card, i) => (
              <PlayingCard key={i} card={card} faceUp />
            ))
          : player.cards.map((card, i) => (
              <PlayingCard
                key={i}
                card={card}
                faceUp={player.status !== "folded" && card >= 0}
              />
            ))}
      </div>

      {showdownResult && !isFolded && (
        <div
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            showdownResult.isWinner
              ? "bg-amber-500/20 text-amber-400"
              : "bg-zinc-800 text-zinc-400"
          }`}
        >
          {showdownResult.handName}
        </div>
      )}

      <div
        className={`flex min-w-[120px] flex-col items-center rounded-xl border px-3 py-2 transition-all ${
          isWinner
            ? "border-amber-400 bg-amber-900/40 shadow-lg"
            : isCurrentTurn
              ? "border-emerald-400 bg-emerald-900/60 shadow-lg shadow-emerald-500/20"
              : isFolded
                ? "border-zinc-700 bg-zinc-900/60 opacity-50"
                : "border-zinc-600 bg-zinc-900/80"
        }`}
        style={isWinner ? { animation: "pulse-gold 2s infinite" } : undefined}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{templateEmojis[player.templateId]}</span>
          <span className="text-sm font-medium text-zinc-200 truncate max-w-[80px]">
            {player.displayName}
          </span>
        </div>

        <div className="text-xs text-zinc-400">
          {player.chips.toLocaleString()} chips
        </div>

        {isAllIn && (
          <span className="mt-0.5 text-xs font-bold text-amber-400">
            ALL IN
          </span>
        )}
        {isFolded && (
          <span className="mt-0.5 text-xs font-bold text-zinc-500">FOLD</span>
        )}

        {player.currentBet > 0 && !isFolded && (
          <div className="mt-1 rounded-full bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300">
            Bet: {player.currentBet}
          </div>
        )}

        {player.isDealer && (
          <div className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-black">
            D
          </div>
        )}
      </div>

      {template && (
        <div className="text-[10px] text-zinc-500">{template.name}</div>
      )}
    </div>
  );
}
