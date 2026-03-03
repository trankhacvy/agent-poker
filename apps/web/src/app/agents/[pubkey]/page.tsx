"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { LazyMotion, domAnimation, m } from "motion/react";
import type { AgentData } from "@/lib/types";
import { TEMPLATES } from "@/lib/constants";
import { fetchAgent, fetchAgentGames, type GameHistoryRecord } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const templateEmojis = ["\u{1F988}", "\u{1F525}", "\u{1FAA8}", "\u{1F98A}"];

interface AgentProfilePageProps {
  params: Promise<{ pubkey: string }>;
}

export default function AgentProfilePage({ params }: AgentProfilePageProps) {
  const { pubkey } = use(params);
  const [agent, setAgent] = useState<AgentData | null>(null);
  const [recentGames, setRecentGames] = useState<GameHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchAgent(pubkey), fetchAgentGames(pubkey, 0, 20)]).then(
      ([agentData, gamesData]) => {
        setAgent(agentData);
        setRecentGames(gamesData.games);
        setLoading(false);
      }
    );
  }, [pubkey]);

  const template = agent ? TEMPLATES[agent.templateId] : TEMPLATES[0];
  const winRate =
    agent && agent.gamesPlayed > 0 ? ((agent.wins / agent.gamesPlayed) * 100).toFixed(1) : "0";
  const avgEarnings =
    agent && agent.gamesPlayed > 0 ? (agent.earnings / agent.gamesPlayed).toFixed(3) : "0";

  function formatTimeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return "< 1h ago";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6">
          <Link
            href="/leaderboard"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {"\u2190"} Back to Leaderboard
          </Link>
        </div>
        <div className="flex flex-col items-center gap-4 py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          <span className="text-muted-foreground">Loading agent profile...</span>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6">
          <Link
            href="/leaderboard"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {"\u2190"} Back to Leaderboard
          </Link>
        </div>
        <div className="flex flex-col items-center gap-2 py-20">
          <span className="text-lg font-medium text-muted-foreground">Agent not found</span>
          <span className="text-sm text-muted-foreground">
            No agent exists with this public key.
          </span>
        </div>
      </div>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6">
          <Link
            href="/leaderboard"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {"\u2190"} Back to Leaderboard
          </Link>
        </div>

        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Card className="mb-8">
            <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
              <div
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-4xl"
                style={{ backgroundColor: `${template.color}20` }}
              >
                {templateEmojis[agent.templateId]}
              </div>
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-foreground">{agent.displayName}</h1>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: template.color }}>
                    {template.name}
                  </span>
                  <span className="text-muted-foreground">|</span>
                  <span className="text-sm text-muted-foreground">{template.description}</span>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="mt-2 cursor-default  text-xs text-muted-foreground">
                      {pubkey.length > 16 ? `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}` : pubkey}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent>{pubkey}</TooltipContent>
                </Tooltip>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-secondary">
                  {agent.balance.toFixed(2)} SOL
                </div>
                <div className="text-xs text-muted-foreground">Balance</div>
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
          <Card className="text-center">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-primary">{agent.wins}</div>
              <div className="text-xs text-muted-foreground">Wins</div>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-foreground">{agent.gamesPlayed}</div>
              <div className="text-xs text-muted-foreground">Games Played</div>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-accent">{winRate}%</div>
              <div className="text-xs text-muted-foreground">Win Rate</div>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-secondary">
                {agent.earnings.toFixed(1)} SOL
              </div>
              <div className="text-xs text-muted-foreground">Total Earnings</div>
            </CardContent>
          </Card>
        </m.div>

        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
        >
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="text-lg text-foreground">Strategy Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-muted-foreground">Template</div>
                  <div className="flex items-center gap-2">
                    <span>{templateEmojis[agent.templateId]}</span>
                    <span className="font-medium" style={{ color: template.color }}>
                      {template.name}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Play Style</div>
                  <div className="text-sm text-muted-foreground">{template.description}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Avg Earnings/Game</div>
                  <div className="text-sm font-medium text-secondary">{avgEarnings} SOL</div>
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
          <h2 className="mb-4 text-lg font-semibold text-foreground">Recent Games</h2>
          {recentGames.length === 0 ? (
            <div className="border-2 border-border px-6 py-10 text-center text-muted-foreground">
              No games played yet.
            </div>
          ) : (
            <div className="overflow-hidden border-2 border-border">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-border bg-muted hover:bg-muted">
                    <TableHead className="text-muted-foreground">Table</TableHead>
                    <TableHead className="text-muted-foreground">Result</TableHead>
                    <TableHead className="text-muted-foreground">Earnings</TableHead>
                    <TableHead className="text-muted-foreground">Players</TableHead>
                    <TableHead className="text-right text-muted-foreground">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentGames.map((game) => {
                    const player = game.players.find((p) => p.pubkey === pubkey);
                    const isWinner = player?.isWinner ?? false;
                    const earnings = isWinner ? game.pot - game.wagerTier : -game.wagerTier;

                    return (
                      <TableRow key={game.gameId} className="border-b border-border">
                        <TableCell>
                          <Link
                            href={`/tables/${game.tableId}`}
                            className="font-medium text-foreground transition-colors hover:text-primary"
                          >
                            {game.tableId.slice(0, 8)}...
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant={isWinner ? "success" : "destructive"}>
                            {isWinner ? "Win" : "Loss"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`font-medium ${
                              earnings >= 0 ? "text-primary" : "text-destructive"
                            }`}
                          >
                            {earnings >= 0 ? "+" : ""}
                            {earnings.toFixed(1)} SOL
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {game.players.length} players
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatTimeAgo(game.completedAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </m.div>
      </div>
    </LazyMotion>
  );
}
