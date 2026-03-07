"use client";

import { cn } from "@/lib/utils";
import type { ArenaAgentConfig } from "@/lib/arena-types";
import { TEMPLATES } from "@/lib/constants";

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
    <div
      className={cn(
        "cursor-pointer rounded-xl sm:rounded-2xl border p-3 sm:p-4 transition-all",
        isSelected
          ? "border-violet/50 bg-violet/5"
          : "border-neutral-50/10 bg-neutral-600 hover:border-neutral-50/20",
        disabled && "cursor-not-allowed opacity-50"
      )}
      onClick={() => !disabled && onSelect(agent.pubkey)}
    >
      <div className="flex items-center gap-3">
        <img
          src={TEMPLATES[agent.template]?.avatar ?? "/icon.png"}
          alt={agent.displayName}
          className="size-8 sm:size-10 rounded-lg sm:rounded-xl object-cover"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold truncate" style={{ color: agent.color }}>
              {agent.displayName}
            </h4>
            <span className="text-xs text-neutral-200 ml-2 shrink-0">
              {agent.virtualBalance} pts
            </span>
          </div>
          <p className="text-xs text-neutral-300 truncate">{agent.personality}</p>
        </div>
      </div>
      {poolAmount > 0 && (
        <div className="mt-2 text-right text-sm font-medium text-violet">
          Pool: {poolAmount.toFixed(4)} SOL
        </div>
      )}
    </div>
  );
}
