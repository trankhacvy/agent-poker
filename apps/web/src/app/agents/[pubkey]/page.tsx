"use client";

import { use, useState } from "react";
import Link from "next/link";
import { LazyMotion, domAnimation, m } from "motion/react";
import type { AgentData } from "@/lib/types";
import { TEMPLATES } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const templateEmojis = ["\u{1F988}", "\u{1F525}", "\u{1FAA8}", "\u{1F98A}"];

interface RecentGame {
  tableId: string;
  result: "win" | "loss";
  earnings: number;
  date: number;
  opponents: number;
}

const mockAgent: AgentData = {
  publicKey: "L1",
  owner: "O1",
  displayName: "AlphaShark",
  templateId: 0,
  balance: 12.5,
  gamesPlayed: 284,
  wins: 142,
  earnings: 45.8,
  createdAt: Date.now() - 86400000 * 30,
};

const mockRecentGames: RecentGame[] = [
  {
    tableId: "table-101",
    result: "win",
    earnings: 2.4,
    date: Date.now() - 3600000,
    opponents: 5,
  },
  {
    tableId: "table-098",
    result: "loss",
    earnings: -0.5,
    date: Date.now() - 7200000,
    opponents: 4,
  },
  {
    tableId: "table-095",
    result: "win",
    earnings: 1.8,
    date: Date.now() - 14400000,
    opponents: 6,
  },
  {
    tableId: "table-090",
    result: "win",
    earnings: 3.1,
    date: Date.now() - 28800000,
    opponents: 5,
  },
  {
    tableId: "table-087",
    result: "loss",
    earnings: -0.5,
    date: Date.now() - 43200000,
    opponents: 4,
  },
  {
    tableId: "table-082",
    result: "loss",
    earnings: -0.5,
    date: Date.now() - 86400000,
    opponents: 6,
  },
  {
    tableId: "table-078",
    result: "win",
    earnings: 1.2,
    date: Date.now() - 172800000,
    opponents: 5,
  },
  {
    tableId: "table-074",
    result: "win",
    earnings: 4.0,
    date: Date.now() - 259200000,
    opponents: 6,
  },
];

interface AgentProfilePageProps {
  params: Promise<{ pubkey: string }>;
}

export default function AgentProfilePage({ params }: AgentProfilePageProps) {
  const { pubkey } = use(params);
  const [agent] = useState<AgentData>(mockAgent);
  const [recentGames] = useState<RecentGame[]>(mockRecentGames);

  const template = TEMPLATES[agent.templateId];
  const winRate =
    agent.gamesPlayed > 0
      ? ((agent.wins / agent.gamesPlayed) * 100).toFixed(1)
      : "0";
  const avgEarnings =
    agent.gamesPlayed > 0
      ? (agent.earnings / agent.gamesPlayed).toFixed(3)
      : "0";

  function formatTimeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "< 1h ago";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <LazyMotion features={domAnimation}>
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6">
          <Link
            href="/leaderboard"
            className="text-sm text-zinc-500 transition-colors hover:text-zinc-300"
          >
            {"\u2190"} Back to Leaderboard
          </Link>
        </div>

        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Card className="mb-8 bg-zinc-900/60">
            <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
              <div
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-4xl"
                style={{ backgroundColor: `${template.color}20` }}
              >
                {templateEmojis[agent.templateId]}
              </div>
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-zinc-100">
                  {agent.displayName}
                </h1>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className="text-sm font-medium"
                    style={{ color: template.color }}
                  >
                    {template.name}
                  </span>
                  <span className="text-zinc-600">|</span>
                  <span className="text-sm text-zinc-500">
                    {template.description}
                  </span>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="mt-2 cursor-default font-mono text-xs text-zinc-600">
                      {pubkey.length > 16 ? `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}` : pubkey}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent>{pubkey}</TooltipContent>
                </Tooltip>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-amber-400">
                  {agent.balance.toFixed(2)} SOL
                </div>
                <div className="text-xs text-zinc-500">Balance</div>
              </div>
            </CardContent>
          </Card>
        </m.div>

        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4"
        >
          <Card className="bg-zinc-900/50 text-center">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-emerald-400">
                {agent.wins}
              </div>
              <div className="text-xs text-zinc-500">Wins</div>
            </CardContent>
          </Card>
          <Card className="bg-zinc-900/50 text-center">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-zinc-200">
                {agent.gamesPlayed}
              </div>
              <div className="text-xs text-zinc-500">Games Played</div>
            </CardContent>
          </Card>
          <Card className="bg-zinc-900/50 text-center">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-blue-400">{winRate}%</div>
              <div className="text-xs text-zinc-500">Win Rate</div>
            </CardContent>
          </Card>
          <Card className="bg-zinc-900/50 text-center">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-amber-400">
                {agent.earnings.toFixed(1)} SOL
              </div>
              <div className="text-xs text-zinc-500">Total Earnings</div>
            </CardContent>
          </Card>
        </m.div>

        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
        >
          <Card className="mb-8 bg-zinc-900/50">
            <CardHeader>
              <CardTitle className="text-lg text-zinc-200">
                Strategy Profile
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-zinc-500">Template</div>
                  <div className="flex items-center gap-2">
                    <span>{templateEmojis[agent.templateId]}</span>
                    <span
                      className="font-medium"
                      style={{ color: template.color }}
                    >
                      {template.name}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Play Style</div>
                  <div className="text-sm text-zinc-300">
                    {template.description}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500">Avg Earnings/Game</div>
                  <div className="text-sm font-medium text-amber-400">
                    {avgEarnings} SOL
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </m.div>

        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <h2 className="mb-4 text-lg font-semibold text-zinc-200">
            Recent Games
          </h2>
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900/50">
                  <TableHead className="text-zinc-500">Table</TableHead>
                  <TableHead className="text-zinc-500">Result</TableHead>
                  <TableHead className="text-zinc-500">Earnings</TableHead>
                  <TableHead className="text-zinc-500">Opponents</TableHead>
                  <TableHead className="text-right text-zinc-500">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentGames.map((game) => (
                  <TableRow
                    key={game.tableId}
                    className="border-b border-zinc-800/50"
                  >
                    <TableCell>
                      <Link
                        href={`/tables/${game.tableId}`}
                        className="font-medium text-zinc-200 transition-colors hover:text-emerald-400"
                      >
                        {game.tableId}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={game.result}>
                        {game.result === "win" ? "Win" : "Loss"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`font-medium ${
                          game.earnings >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {game.earnings >= 0 ? "+" : ""}
                        {game.earnings.toFixed(1)} SOL
                      </span>
                    </TableCell>
                    <TableCell className="text-zinc-400">
                      {game.opponents} players
                    </TableCell>
                    <TableCell className="text-right text-zinc-500">
                      {formatTimeAgo(game.date)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </m.div>
      </div>
    </LazyMotion>
  );
}
