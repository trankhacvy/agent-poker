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
  hearts: "text-red-500",
  diamonds: "text-red-500",
  clubs: "text-zinc-100",
  spades: "text-zinc-100",
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
}

export default function PlayingCard({ card, faceUp }: CardProps) {
  if (!faceUp) {
    return (
      <div className="flex h-20 w-14 items-center justify-center rounded-lg border border-zinc-600 bg-gradient-to-br from-blue-900 to-blue-700 shadow-lg">
        <div className="h-14 w-8 rounded border border-blue-400/30 bg-blue-800">
          <div className="flex h-full items-center justify-center text-lg text-blue-400/50">
            ♠
          </div>
        </div>
      </div>
    );
  }

  const { rank, suit } = decodeCard(card);
  const symbol = suitSymbols[suit];
  const color = suitColors[suit];

  return (
    <div className="flex h-20 w-14 flex-col justify-between rounded-lg border border-zinc-500 bg-white p-1 shadow-lg">
      <div className={`text-xs font-bold leading-none ${color}`}>
        <div>{rank}</div>
        <div>{symbol}</div>
      </div>
      <div className={`self-center text-2xl ${color}`}>{symbol}</div>
      <div className={`rotate-180 self-end text-xs font-bold leading-none ${color}`}>
        <div>{rank}</div>
        <div>{symbol}</div>
      </div>
    </div>
  );
}
