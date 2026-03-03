"use client";

import { useEffect, useRef } from "react";
import type { GameAction } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ActionFeedProps {
  actions: GameAction[];
}

const actionColors: Record<string, string> = {
  fold: "text-muted-foreground",
  check: "text-foreground",
  call: "text-accent",
  raise: "text-secondary",
  "all-in": "text-destructive",
  "post-blind": "text-muted-foreground",
  deal: "text-primary",
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
    <Card>
      <CardHeader className="border-b border-border py-2 px-4">
        <CardTitle className="text-sm font-medium text-foreground">Action Feed</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-64">
          <div ref={scrollRef} className="flex flex-col gap-1 p-3">
            {actions.length === 0 && (
              <p className="text-center text-sm text-muted-foreground">
                Waiting for actions...
              </p>
            )}
            {actions.slice().reverse().map((action) => (
              <div
                key={action.id}
                className={`text-sm ${actionColors[action.actionType] ?? "text-muted-foreground"}`}
              >
                <span className="mr-2 text-muted-foreground">
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
