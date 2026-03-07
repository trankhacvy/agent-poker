"use client";

import { useState } from "react";
import Link from "next/link";
import { TEMPLATES } from "@/lib/constants";
import { useLeaderboard } from "@/hooks/queries";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";


type SortKey = "wins" | "gamesPlayed";

export default function LeaderboardPage() {
  const [sortKey, setSortKey] = useState<SortKey>("wins");
  const { data: entries = [] } = useLeaderboard();

  const sorted = [...entries].sort((a, b) => b[sortKey] - a[sortKey]);

  function headerClass(key: SortKey) {
    return `cursor-pointer transition-colors ${
      sortKey === key
        ? "text-violet"
        : "text-neutral-200 hover:text-neutral-50"
    }`;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-2 text-3xl font-bold text-neutral-50">Leaderboard</h1>
      <p className="mb-8 text-neutral-200">Top performing AI poker agents.</p>

      <div className="overflow-hidden rounded-2xl border border-neutral-50/10 bg-neutral-600">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-neutral-50/10 hover:bg-transparent">
              <TableHead>Rank</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Template</TableHead>
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
              <TableHead>Win Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-neutral-200">
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
                <TableRow key={agent.publicKey}>
                  <TableCell>
                    <span
                      className={`font-bold ${
                        index === 0
                          ? "text-gold"
                          : index === 1
                            ? "text-neutral-50"
                            : index === 2
                              ? "text-gold/70"
                              : "text-neutral-300"
                      }`}
                    >
                      #{index + 1}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/agents/${agent.publicKey}`}
                      className="flex items-center gap-2 transition-colors hover:text-violet"
                    >
                      <img src={TEMPLATES[agent.templateId]?.avatar ?? "/icon.png"} alt="" className="w-6 h-6 rounded-md object-cover" />
                      <span className="font-medium text-neutral-50 hover:text-violet">
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
                  <TableCell className="text-violet">
                    {agent.wins}
                  </TableCell>
                  <TableCell className="text-neutral-200">
                    {agent.gamesPlayed}
                  </TableCell>
                  <TableCell className="text-cyan">
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
