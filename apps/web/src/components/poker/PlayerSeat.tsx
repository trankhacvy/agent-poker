import type { PlayerSnapshot, ShowdownResult } from "@/lib/types";
import { TEMPLATES } from "@/lib/constants";
import PlayingCard from "./PlayingCard";

interface PlayerSeatProps {
  player: PlayerSnapshot;
  isCurrentTurn: boolean;
  seatPosition: number;
  totalSeats: number;
  showdownResult?: ShowdownResult;
  isWinner?: boolean;
}

const templateEmojis = ["\u{1F988}", "\u{1F525}", "\u{1FAA8}", "\u{1F98A}"];

/**
 * Seat positions around the oval table for 2-6 players.
 * Each position: { x%, y% } relative to the table container centre,
 * plus an alignment hint so the info-box doesn't overlap the felt.
 */
const SEAT_LAYOUTS: Record<
  number,
  { x: string; y: string; align: string }[]
> = {
  2: [
    { x: "50%", y: "105%", align: "items-center" }, // bottom (hero)
    { x: "50%", y: "-5%", align: "items-center" }, // top
  ],
  3: [
    { x: "50%", y: "105%", align: "items-center" },
    { x: "5%", y: "15%", align: "items-center" },
    { x: "95%", y: "15%", align: "items-center" },
  ],
  4: [
    { x: "50%", y: "105%", align: "items-center" },
    { x: "2%", y: "50%", align: "items-center" },
    { x: "50%", y: "-5%", align: "items-center" },
    { x: "98%", y: "50%", align: "items-center" },
  ],
  5: [
    { x: "50%", y: "105%", align: "items-center" },
    { x: "3%", y: "70%", align: "items-center" },
    { x: "15%", y: "5%", align: "items-center" },
    { x: "85%", y: "5%", align: "items-center" },
    { x: "97%", y: "70%", align: "items-center" },
  ],
  6: [
    { x: "50%", y: "105%", align: "items-center" },
    { x: "3%", y: "72%", align: "items-center" },
    { x: "10%", y: "5%", align: "items-center" },
    { x: "50%", y: "-5%", align: "items-center" },
    { x: "90%", y: "5%", align: "items-center" },
    { x: "97%", y: "72%", align: "items-center" },
  ],
};

function getSeatPosition(index: number, total: number) {
  const layout = SEAT_LAYOUTS[total] ?? SEAT_LAYOUTS[6];
  return layout[index % layout.length];
}

function ThinkingTimer() {
  return (
    <div className="absolute -left-10 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full border-[3px] border-[#64d2d0] flex items-center justify-center bg-[#1b2531] shadow-lg animate-pulse">
      <span className="text-[10px] font-bold text-white">
        <svg className="w-4 h-4 text-[#64d2d0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      </span>
    </div>
  );
}

export default function PlayerSeat({
  player,
  isCurrentTurn,
  seatPosition,
  totalSeats,
  showdownResult,
  isWinner = false,
}: PlayerSeatProps) {
  const template = TEMPLATES[player.templateId];
  const isFolded = player.status === "folded";
  const isAllIn = player.status === "all-in";
  const showCards = showdownResult && !isFolded;

  const pos = getSeatPosition(seatPosition, totalSeats);

  return (
    <div
      className="absolute flex flex-col items-center z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Cards */}
      <div className={`flex -space-x-3 mb-1.5 ${isFolded ? "opacity-40" : ""}`}>
        {showCards
          ? showdownResult.cards.map((card, i) => (
              <div key={i} className="transform hover:-translate-y-1 transition-transform">
                <PlayingCard card={card} faceUp size="sm" />
              </div>
            ))
          : player.cards.map((card, i) => (
              <div key={i} className="transform hover:-translate-y-1 transition-transform">
                <PlayingCard
                  card={card}
                  faceUp={!isFolded && card >= 0}
                  size="sm"
                />
              </div>
            ))}
      </div>

      {/* Hand name on showdown */}
      {showdownResult && !isFolded && (
        <div
          className={`rounded-full px-2 py-0.5 text-[9px] font-bold mb-1 ${
            showdownResult.isWinner
              ? "bg-[#fca311]/20 text-[#fca311]"
              : "bg-white/5 text-zinc-400"
          }`}
        >
          {showdownResult.handName}
        </div>
      )}

      {/* Info box */}
      <div
        className={`bg-[#232f3e] rounded-lg p-2 min-w-[110px] border shadow-xl relative transition-all ${
          isWinner
            ? "border-[#fca311] shadow-[#fca311]/20"
            : isCurrentTurn
              ? "border-[#64d2d0] shadow-[#64d2d0]/20"
              : isFolded
                ? "border-white/5 opacity-50"
                : "border-white/5"
        }`}
        style={
          isWinner
            ? { animation: "pulse-gold 2s infinite" }
            : undefined
        }
      >
        {/* Active turn indicator */}
        {isCurrentTurn && player.status === "active" && <ThinkingTimer />}

        {/* Name row */}
        <div className="flex justify-between items-center mb-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs">{templateEmojis[player.templateId]}</span>
            <span
              className={`text-[10px] font-bold truncate max-w-[70px] ${
                isFolded ? "text-[#ff6b6b]" : "text-white/60"
              }`}
            >
              {player.displayName}
            </span>
          </div>
        </div>

        {/* Balance row */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white">
            {player.chips.toLocaleString()}
          </span>
          <span className="text-[#64d2d0] text-[10px]">SOL</span>
        </div>

        {/* Status badges */}
        {isAllIn && (
          <div className="mt-1 text-center">
            <span className="text-[9px] font-bold text-[#ff6b6b] bg-[#ff6b6b]/10 px-1.5 py-0.5 rounded">
              ALL IN
            </span>
          </div>
        )}
        {isFolded && (
          <div className="mt-1 text-center">
            <span className="text-[9px] font-bold text-zinc-500 bg-zinc-500/10 px-1.5 py-0.5 rounded">
              FOLD
            </span>
          </div>
        )}

        {/* Dealer chip */}
        {player.isDealer && (
          <div className="absolute -right-2 -top-2 w-5 h-5 rounded-full bg-white text-[#161d26] text-[8px] font-bold flex items-center justify-center shadow-md border border-white/20">
            D
          </div>
        )}
      </div>

      {/* Bet chip */}
      {player.currentBet > 0 && !isFolded && (
        <div className="flex items-center gap-1 mt-1.5">
          <div className="w-4 h-4 rounded-full bg-[#64d2d0] border-2 border-[#1b2531] flex items-center justify-center shadow">
            <span className="text-[6px] font-bold text-[#161d26]">$</span>
          </div>
          <span className="text-[10px] font-medium text-[#64d2d0]">
            {player.currentBet}
          </span>
        </div>
      )}

      {/* Template label */}
      {template && (
        <div className="text-[9px] text-white/20 mt-0.5">{template.name}</div>
      )}
    </div>
  );
}
