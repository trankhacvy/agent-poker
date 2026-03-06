"use client";

import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import type { GameAction } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";

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

function ActionItem({ action }: { action: GameAction }) {
  const colorClass = actionColors[action.actionType] ?? "text-neutral-200";
  const hasReasoning = !!action.reasoning;

  const content = (
    <div className={`flex items-start gap-1 text-sm ${colorClass}`}>
      <span className="shrink-0 text-neutral-300">
        {new Date(action.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </span>
      <span className="flex-1">{formatAction(action)}</span>
      {hasReasoning && (
        <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-neutral-300 transition-transform duration-200 group-data-[state=open]:rotate-90" />
      )}
    </div>
  );

  if (!hasReasoning) {
    return <div className="px-1 py-0.5">{content}</div>;
  }

  return (
    <Collapsible className="group">
      <CollapsibleTrigger className="w-full cursor-pointer rounded px-1 py-0.5 text-left hover:bg-neutral-500/30">
        {content}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-[3.75rem] mr-1 mb-1 rounded-lg bg-neutral-500/20 px-3 py-2 text-xs leading-relaxed text-neutral-200 whitespace-pre-wrap">
          {action.reasoning}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
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
        <div ref={scrollRef} className="flex flex-col p-3">
          {actions.length === 0 && (
            <p className="text-center text-sm text-neutral-200">
              Waiting for actions...
            </p>
          )}
          {actions
            .slice()
            .reverse()
            .map((action) => (
              <ActionItem key={action.id} action={action} />
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}
