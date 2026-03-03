"use client";

import { cn } from "@/lib/utils";

export interface BalanceDisplayProps extends React.HTMLAttributes<HTMLSpanElement> {
  lamports?: bigint | number;
  showSymbol?: boolean;
  decimals?: number;
}

const LAMPORTS_PER_SOL = 1_000_000_000;

function formatBalance(lamports: bigint | number, decimals: number): string {
  const value = Number(lamports) / LAMPORTS_PER_SOL;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function BalanceDisplay({
  className,
  lamports,
  showSymbol = true,
  decimals = 4,
  ...props
}: BalanceDisplayProps) {
  if (lamports === undefined) {
    return (
      <span className={cn("text-muted-foreground text-sm", className)} {...props}>
        --
      </span>
    );
  }

  return (
    <span className={cn("text-sm font-medium tabular-nums", className)} {...props}>
      {formatBalance(lamports, decimals)}
      {showSymbol && <span className="text-muted-foreground ml-1">SOL</span>}
    </span>
  );
}
