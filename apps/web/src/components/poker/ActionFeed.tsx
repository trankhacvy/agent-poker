"use client";

import { useEffect, useRef } from "react";
import type { GameAction } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ActionFeedProps {
  actions: GameAction[];
}

const actionColors: Record<string, string> = {
  fold: "text-neutral-300",
  check: "text-neutral-50",
  call: "text-cyan",
  raise: "text-gold",
  "all-in": "text-coral",
  "post-blind": "text-neutral-300",
  deal: "text-violet",
};

function formatAction(action: GameAction): string {
  switch (action.actionType) {
    case "fold":
      return `${action.playerName} folded`;
    case "check":
      return `${action.playerName} checked`;
    case "call":
      return `${action.playerName} called ${action.amount}`;
    case "raise":
      return `${action.playerName} raised to ${action.amount}`;
    case "all-in":
      return `${action.playerName} went all-in for ${action.amount}`;
    case "post-blind":
      return `${action.playerName} posted blind ${action.amount}`;
    case "deal":
      return `Cards dealt`;
  }
}

export default function ActionFeed({ actions }: ActionFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [actions]);

  return (
    <div className="rounded-2xl border border-neutral-50/10 bg-neutral-600 overflow-hidden">
      <div className="border-b border-neutral-50/10 px-4 py-3">
        <h3 className="text-sm font-semibold text-neutral-50">Action Feed</h3>
      </div>
      <ScrollArea className="h-64">
        <div ref={scrollRef} className="flex flex-col gap-1 p-3">
          {actions.length === 0 && (
            <p className="text-center text-sm text-neutral-200">
              Waiting for actions...
            </p>
          )}
          {actions.slice().reverse().map((action) => (
            <div
              key={action.id}
              className={`text-sm ${actionColors[action.actionType] ?? "text-neutral-200"}`}
            >
              <span className="mr-2 text-neutral-300">
                {new Date(action.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              {formatAction(action)}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
