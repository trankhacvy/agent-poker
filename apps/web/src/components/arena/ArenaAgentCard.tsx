"use client";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import type { ArenaAgentConfig } from "@/lib/arena-types";

interface ArenaAgentCardProps {
  agent: ArenaAgentConfig;
  poolAmount: number;
  isSelected: boolean;
  onSelect: (pubkey: string) => void;
  disabled?: boolean;
}

export default function ArenaAgentCard({
  agent,
  poolAmount,
  isSelected,
  onSelect,
  disabled,
}: ArenaAgentCardProps) {
  return (
    <Card
      className={cn(
        "cursor-pointer border-2 p-4 transition-all hover:border-primary/50",
        isSelected && "border-primary bg-primary/5",
        disabled && "cursor-not-allowed opacity-50"
      )}
      onClick={() => !disabled && onSelect(agent.pubkey)}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex size-10 items-center justify-center rounded-full text-lg font-bold text-white"
          style={{ backgroundColor: agent.color }}
        >
          {agent.displayName.charAt(0)}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h4 className="font-bold" style={{ color: agent.color }}>
              {agent.displayName}
            </h4>
            <span className="text-xs text-muted-foreground">
              {agent.virtualBalance} pts
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{agent.personality}</p>
        </div>
      </div>
      {poolAmount > 0 && (
        <div className="mt-2 text-right text-sm font-medium text-primary">
          Pool: {poolAmount.toFixed(4)} SOL
        </div>
      )}
    </Card>
  );
}
