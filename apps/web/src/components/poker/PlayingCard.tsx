import type { Rank, Suit } from "@/lib/types";

const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS: Suit[] = ["hearts", "diamonds", "clubs", "spades"];

const suitSymbols: Record<Suit, string> = {
  hearts: "\u2665",
  diamonds: "\u2666",
  clubs: "\u2663",
  spades: "\u2660",
};

const suitColors: Record<Suit, string> = {
  hearts: "text-[#ff6b6b]",
  diamonds: "text-[#fca311]",
  clubs: "text-[#4ea8de]",
  spades: "text-[#64d2d0]",
};

function decodeCard(code: number): { rank: Rank; suit: Suit } {
  const value = code % 13;
  const suitIndex = Math.floor(code / 13);
  return {
    rank: RANKS[value],
    suit: SUITS[suitIndex],
  };
}

interface CardProps {
  card: number;
  faceUp: boolean;
  size?: "sm" | "md" | "lg";
}

export default function PlayingCard({ card, faceUp, size = "md" }: CardProps) {
  const sizes = {
    sm: "w-10 h-14",
    md: "w-12 h-[4.25rem]",
    lg: "w-[4.5rem] h-[6.25rem]",
  };

  const rankSizes = {
    sm: "text-base",
    md: "text-xl",
    lg: "text-3xl",
  };

  const cornerSizes = {
    sm: "text-[8px]",
    md: "text-[10px]",
    lg: "text-sm",
  };

  if (!faceUp) {
    return (
      <div
        className={`${sizes[size]} flex-shrink-0 rounded-lg border-2 border-white/10 bg-[#64d2d0] shadow-lg relative overflow-hidden`}
      >
        <div className="absolute inset-0 opacity-20 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.2)_25%,rgba(255,255,255,0.2)_50%,transparent_50%,transparent_75%,rgba(255,255,255,0.2)_75%,rgba(255,255,255,0.2)_100%)] bg-[length:8px_8px]" />
      </div>
    );
  }

  const { rank, suit } = decodeCard(card);
  const symbol = suitSymbols[suit];
  const color = suitColors[suit];

  return (
    <div
      className={`${sizes[size]} flex-shrink-0 rounded-lg border border-white/10 bg-[#232f3e] shadow-lg flex flex-col items-center justify-center relative`}
    >
      <span className={`font-bold ${color} ${rankSizes[size]}`}>{rank}</span>
      <span className={`absolute top-1 left-1.5 ${color} ${cornerSizes[size]} leading-none`}>
        {symbol}
      </span>
      <span className={`absolute bottom-1 right-1.5 rotate-180 ${color} ${cornerSizes[size]} leading-none`}>
        {symbol}
      </span>
    </div>
  );
}
