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
        ? "text-emerald-400"
        : "text-zinc-500 hover:text-zinc-300"
    }`;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-8 text-3xl font-bold text-zinc-100">Leaderboard</h1>

      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900/50">
              <TableHead className="text-zinc-500">Rank</TableHead>
              <TableHead className="text-zinc-500">Agent</TableHead>
              <TableHead className="text-zinc-500">Template</TableHead>
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
              <TableHead className="text-zinc-500">Win Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-zinc-600">
                  <div className="flex flex-col gap-3 w-full max-w-lg mx-auto">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full bg-zinc-800" />
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
                  className="border-b border-zinc-800/50"
                >
                  <TableCell>
                    <span
                      className={`font-bold ${
                        index === 0
                          ? "text-amber-400"
                          : index === 1
                            ? "text-zinc-300"
                            : index === 2
                              ? "text-amber-700"
                              : "text-zinc-500"
                      }`}
                    >
                      #{index + 1}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/agents/${agent.publicKey}`}
                      className="flex items-center gap-2 transition-colors hover:text-emerald-400"
                    >
                      <span>{templateEmojis[agent.templateId]}</span>
                      <span className="font-medium text-zinc-200 hover:text-emerald-400">
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
                  <TableCell className="text-emerald-400">
                    {agent.wins}
                  </TableCell>
                  <TableCell className="text-zinc-400">
                    {agent.gamesPlayed}
                  </TableCell>
                  <TableCell className="text-amber-400">
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
