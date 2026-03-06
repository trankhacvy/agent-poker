"use client";

import type { Rank, Suit } from "@/lib/types";
import { m } from "motion/react";

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
  clubs: "text-gray-800",
  spades: "text-gray-800",
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
  index?: number;
  animateFlip?: boolean;
  animateDeal?: boolean;
}

const sizes = {
  sm: "w-9 h-[52px]",
  md: "w-12 h-[68px]",
  lg: "w-[60px] h-[84px]",
};

const rankSizes = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl",
};

const cornerSizes = {
  sm: "text-[7px]",
  md: "text-[9px]",
  lg: "text-xs",
};

export default function PlayingCard({
  card,
  faceUp,
  size = "md",
  index = 0,
  animateFlip = false,
  animateDeal = false,
}: CardProps) {
  const { rank, suit } = decodeCard(card);
  const symbol = suitSymbols[suit];
  const color = suitColors[suit];

  const cardFront = (
    <div
      className={`${sizes[size]} flex-shrink-0 rounded bg-white shadow-lg flex flex-col items-center justify-center relative border`}
      style={{ backfaceVisibility: animateFlip ? "hidden" : undefined }}
    >
      {/* Center rank + suit */}
      <span className={`font-bold ${color} ${rankSizes[size]} leading-none`}>{rank}</span>
      <span className={`${color} text-[10px] leading-none mt-0.5`}>{symbol}</span>
      {/* Top-left corner */}
      <span
        className={`absolute top-1 left-1.5 ${color} ${cornerSizes[size]} leading-none font-semibold`}
      >
        {rank}
        <br />
        {symbol}
      </span>
      {/* Bottom-right corner */}
      <span
        className={`absolute bottom-1 right-1.5 rotate-180 ${color} ${cornerSizes[size]} leading-none font-semibold`}
      >
        {rank}
        <br />
        {symbol}
      </span>
    </div>
  );

  const cardBack = (
    <div
      className={`${sizes[size]} flex-shrink-0 rounded shadow-lg relative overflow-hidden`}
      style={{
        backgroundImage: "url(/card-back.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backfaceVisibility: animateFlip ? "hidden" : undefined,
        transform: animateFlip ? "rotateY(180deg)" : undefined,
      }}
    />
  );

  const content = faceUp ? cardFront : cardBack;

  if (animateDeal) {
    return (
      <m.div
        initial={{ opacity: 0, y: -30, scale: 0.5 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{
          duration: 0.4,
          delay: index * 0.1,
          type: "spring",
          stiffness: 300,
          damping: 20,
        }}
      >
        {content}
      </m.div>
    );
  }

  return content;
}
