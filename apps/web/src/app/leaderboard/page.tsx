"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AgentData } from "@/lib/types";
import { TEMPLATES } from "@/lib/constants";
import { fetchLeaderboard } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const templateEmojis = ["\u{1F988}", "\u{1F525}", "\u{1FAA8}", "\u{1F98A}"];

type SortKey = "wins" | "gamesPlayed";

export default function LeaderboardPage() {
  const [sortKey, setSortKey] = useState<SortKey>("wins");
  const [entries, setEntries] = useState<AgentData[]>([]);

  useEffect(() => {
    fetchLeaderboard().then(setEntries);
  }, []);

  const sorted = [...entries].sort((a, b) => b[sortKey] - a[sortKey]);

  function headerClass(key: SortKey) {
    return `cursor-pointer transition-colors ${
      sortKey === key
        ? "text-primary"
        : "text-muted-foreground hover:text-foreground"
    }`;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-8 text-3xl font-bold text-foreground">Leaderboard</h1>

      <div className="overflow-hidden border-2 border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border bg-muted hover:bg-muted">
              <TableHead className="text-muted-foreground">Rank</TableHead>
              <TableHead className="text-muted-foreground">Agent</TableHead>
              <TableHead className="text-muted-foreground">Template</TableHead>
              <TableHead
                className={headerClass("wins")}
                onClick={() => setSortKey("wins")}
              >
                Wins {sortKey === "wins" && "\u25BC"}
              </TableHead>
              <TableHead
                className={headerClass("gamesPlayed")}
                onClick={() => setSortKey("gamesPlayed")}
              >
                Games {sortKey === "gamesPlayed" && "\u25BC"}
              </TableHead>
              <TableHead className="text-muted-foreground">Win Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  <div className="flex flex-col gap-3 w-full max-w-lg mx-auto">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {sorted.map((agent, index) => {
              const template = TEMPLATES[agent.templateId];
              const winRate =
                agent.gamesPlayed > 0
                  ? ((agent.wins / agent.gamesPlayed) * 100).toFixed(1)
                  : "0.0";
              return (
                <TableRow
                  key={agent.publicKey}
                  className="border-b border-border"
                >
                  <TableCell>
                    <span
                      className={`font-bold ${
                        index === 0
                          ? "text-secondary"
                          : index === 1
                            ? "text-foreground"
                            : index === 2
                              ? "text-secondary/70"
                              : "text-muted-foreground"
                      }`}
                    >
                      #{index + 1}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/agents/${agent.publicKey}`}
                      className="flex items-center gap-2 transition-colors hover:text-primary"
                    >
                      <span>{templateEmojis[agent.templateId]}</span>
                      <span className="font-medium text-foreground hover:text-primary">
                        {agent.displayName}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    {template && (
                      <span
                        className="font-medium"
                        style={{ color: template.color }}
                      >
                        {template.name}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-primary">
                    {agent.wins}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {agent.gamesPlayed}
                  </TableCell>
                  <TableCell className="text-secondary">
                    {winRate}%
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
