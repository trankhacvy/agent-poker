"use client";

import { useEffect, useRef } from "react";
import type { GameAction } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ActionFeedProps {
  actions: GameAction[];
}

const actionColors: Record<string, string> = {
  fold: "text-zinc-500",
  check: "text-zinc-300",
  call: "text-blue-400",
  raise: "text-amber-400",
  "all-in": "text-red-400",
  "post-blind": "text-zinc-400",
  deal: "text-emerald-400",
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
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [actions]);

  return (
    <Card className="bg-zinc-900/60">
      <CardHeader className="border-b border-zinc-800 py-2 px-4">
        <CardTitle className="text-sm font-medium text-zinc-300">Action Feed</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-64">
          <div ref={scrollRef} className="flex flex-col gap-1 p-3">
            {actions.length === 0 && (
              <p className="text-center text-sm text-zinc-600">
                Waiting for actions...
              </p>
            )}
            {actions.map((action) => (
              <div
                key={action.id}
                className={`text-sm ${actionColors[action.actionType] ?? "text-zinc-400"}`}
              >
                <span className="mr-2 text-zinc-600">
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
      </CardContent>
    </Card>
  );
}
