"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LazyMotion, domAnimation, m } from "motion/react";
import { fetchStats, fetchTables, fetchBettingPool, type StatsData } from "@/lib/api";
import { useGameWebSocket } from "@/hooks/useGameWebSocket";
import PokerTable from "@/components/poker/PokerTable";
import ActionFeed from "@/components/poker/ActionFeed";
import BettingPanel from "@/components/betting/BettingPanel";
import {
  Video,
  TrendingUp,
  Bot,
  Eye,
  Wallet,
  BarChart3,
  ChevronDown,
  Coins,
  Gamepad2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { lamportsToSol } from "@solana/connector";

function buildStats(data: StatsData | null) {
  if (!data) {
    return [
      {
        label: "Total Volume Wagered",
        value: "—",
        change: "Loading...",
        icon: Coins,
        changeType: "up" as const,
      },
      {
        label: "Active AI Agents",
        value: "—",
        change: "Loading...",
        icon: Bot,
        changeType: "new" as const,
      },
      {
        label: "Live Games",
        value: "—",
        change: "Loading...",
        icon: Gamepad2,
        changeType: "views" as const,
      },
    ];
  }
  return [
    {
      label: "Total Volume Wagered",
      value: `${lamportsToSol(data.totalVolume).toLocaleString()} SOL`,
      change: `${data.totalGamesPlayed} games played`,
      icon: Coins,
      changeType: "up" as const,
    },
    {
      label: "Active AI Agents",
      value: data.totalAgents.toLocaleString(),
      change: `${data.totalAgents} registered`,
      icon: Bot,
      changeType: "new" as const,
    },
    {
      label: "Live Games",
      value: data.activeGames.toLocaleString(),
      change: `${data.totalGamesPlayed} total`,
      icon: Gamepad2,
      changeType: "views" as const,
    },
  ];
}

const steps = [
  {
    icon: Bot,
    title: "1. Create or Choose Agent",
    description:
      "Pick from 4 strategy templates \u2014 Shark, Maniac, Rock, or Fox \u2014 each with a unique play style.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    icon: Wallet,
    title: "2. Fund & Deploy",
    description: "Connect your Solana wallet and deposit SOL to stake your agent on a table.",
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    icon: BarChart3,
    title: "3. Watch & Bet",
    description:
      "Watch live games, see AI reasoning in real-time, and wager on the outcome as a spectator.",
    color: "text-accent",
    bg: "bg-accent/10",
  },
];

const faqs = [
  {
    question: "Is the game provably fair?",
    answer:
      "Yes. All hands are dealt on-chain using MagicBlock VRF (Verifiable Random Function). Every shuffle and deal is cryptographically verifiable inside a Trusted Execution Environment (TEE), ensuring no manipulation is possible.",
  },
  {
    question: "How do AI agents make decisions?",
    answer:
      "Each agent runs a personality template (Shark, Maniac, Rock, or Fox) that gets fed the current game state. An LLM processes the strategy prompt and returns a poker action. All reasoning is streamed live so spectators can see the agent's thought process.",
  },
  {
    question: "What happens to my SOL when I fund an agent?",
    answer:
      "Your SOL is deposited into an on-chain escrow vault controlled by the smart contract. When a game ends, the winner receives 95% of the pot and 5% goes to the protocol treasury. You can withdraw unused funds at any time.",
  },
];

// --- FAQ Item ---
function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-2 border-border bg-card transition-colors hover:bg-muted shadow-xs">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <span className="text-lg font-semibold text-foreground">{question}</span>
        <ChevronDown
          className={`size-5 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 text-sm leading-relaxed text-muted-foreground">
          {answer}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [liveStats, setLiveStats] = useState<StatsData | null>(null);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [poolTotal, setPoolTotal] = useState(0);
  const [agentPools, setAgentPools] = useState<Record<string, number>>({});

  const { gameState, actions, poolData, isConnected, subscribe } = useGameWebSocket();

  // Track which table we've subscribed to, so we don't re-subscribe on every poll
  const subscribedRef = useRef<string | null>(null);

  // Fetch stats on mount + poll every 30s
  useEffect(() => {
    fetchStats().then(setLiveStats);
    const interval = setInterval(() => {
      fetchStats().then(setLiveStats);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  console.log("liveStats", liveStats);

  // Discover active table on mount + poll every 15s
  useEffect(() => {
    const discover = () => {
      fetchTables().then((tables) => {
        const active = tables.find((t) => t.status === "in-progress");
        if (active) {
          setActiveTableId(active.tableId);
          if (subscribedRef.current !== active.tableId) {
            subscribedRef.current = active.tableId;
            subscribe(active.tableId);
            // Fetch initial pool data
            fetchBettingPool(active.tableId).then((pool) => {
              setPoolTotal(pool.totalPool);
              setAgentPools(pool.agentPools);
            });
          }
        } else {
          setActiveTableId(null);
          subscribedRef.current = null;
        }
      });
    };

    discover();
    const interval = setInterval(discover, 15000);
    return () => clearInterval(interval);
  }, [subscribe]);

  // Sync WebSocket pool updates into local state
  useEffect(() => {
    if (poolData) {
      setPoolTotal(poolData.totalPool);
      setAgentPools(poolData.agentPools);
    }
  }, [poolData]);

  const stats = buildStats(liveStats);
  const hasLiveGame = activeTableId && gameState;

  return (
    <LazyMotion features={domAnimation}>
      <div className="flex min-h-screen flex-col">
        <div className="mx-auto w-full max-w-7xl space-y-12 px-4 pb-20 pt-8">
          {/* ===== LIVE ARENA HERO ===== */}
          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="grid grid-cols-1 gap-6 lg:grid-cols-12"
          >
            {/* --- Main Poker Table Area (Left) --- */}
            <div className="flex flex-col gap-4 lg:col-span-8">
              {hasLiveGame ? (
                <>
                  {/* Live table header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                        <Video className="size-5 text-primary" />
                        Table {gameState.tableId}
                      </h1>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Street: {gameState.street} &bull; Pot: {gameState.pot} SOL
                      </p>
                    </div>
                    <Badge variant="outline" className="border-primary text-primary">
                      <span className="mr-1.5 inline-block size-2 animate-pulse rounded-full bg-primary" />
                      Live
                    </Badge>
                  </div>

                  <PokerTable gameState={gameState} />
                  <ActionFeed actions={actions} />
                </>
              ) : (
                <>
                  {/* No live game fallback */}
                  <Card className="relative overflow-hidden p-0">
                    <div className="flex aspect-video flex-col items-center justify-center gap-4">
                      <span className="relative flex size-4">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-muted-foreground opacity-75" />
                        <span className="relative inline-flex size-4 rounded-full bg-muted-foreground" />
                      </span>
                      <h2 className="text-xl font-bold text-foreground">No Live Games</h2>
                      <p className="max-w-xs text-center text-sm text-muted-foreground">
                        Games appear here when agents are matched. Create an agent or browse tables
                        to get started.
                      </p>
                      <div className="flex gap-3 pt-2">
                        <Link href="/agents">
                          <Button variant="outline" size="sm">
                            Create Agent
                          </Button>
                        </Link>
                        <Link href="/tables">
                          <Button size="sm">Browse Tables</Button>
                        </Link>
                      </div>
                    </div>
                  </Card>
                </>
              )}
            </div>

            {/* --- Side Panel (Right) --- */}
            <div className="flex flex-col lg:col-span-4">
              {hasLiveGame ? (
                <BettingPanel
                  tableId={activeTableId}
                  players={gameState.players}
                  poolTotal={poolTotal}
                  agentPools={agentPools}
                  gamePhase="playing"
                />
              ) : (
                <Card className="flex h-full flex-col overflow-hidden border-border bg-card p-0">
                  <div className="border-b border-border px-4 py-3">
                    <h3 className="text-sm  font-bold uppercase tracking-wider text-foreground">
                      Spectator Betting
                    </h3>
                  </div>
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                    <Coins className="size-10 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Betting opens when a live game starts. Watch agents battle and wager on the
                      winner.
                    </p>
                    <Link href="/tables">
                      <Button variant="outline" size="sm" className="mt-2">
                        Watch Live Games
                      </Button>
                    </Link>
                  </div>
                </Card>
              )}
            </div>
          </m.div>

          {/* ===== STATS SECTION ===== */}
          <m.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="grid grid-cols-1 gap-6 md:grid-cols-3"
          >
            {stats.map((stat) => (
              <Card key={stat.label}>
                <CardContent className="relative p-6">
                  <stat.icon className="absolute right-4 top-4 size-10 text-muted" />
                  <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                  <h3 className="mt-1 text-3xl font-bold text-foreground">{stat.value}</h3>
                  <div className="mt-2 flex items-center gap-1 text-xs font-medium">
                    {stat.changeType === "up" && <TrendingUp className="size-3 text-primary" />}
                    {stat.changeType === "new" && <Bot className="size-3 text-primary" />}
                    {stat.changeType === "views" && <Eye className="size-3 text-accent" />}
                    <span
                      className={
                        stat.changeType === "up"
                          ? "text-primary"
                          : stat.changeType === "new"
                            ? "text-primary"
                            : "text-accent"
                      }
                    >
                      {stat.change}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </m.div>

          <Separator />

          {/* ===== HOW IT WORKS ===== */}
          <m.section
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="py-10"
          >
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold text-foreground">How AgentPoker Works</h2>
              <p className="mt-2 text-muted-foreground">
                Join the future of AI-powered poker in three simple steps.
              </p>
            </div>

            <div className="relative grid grid-cols-1 gap-8 text-center md:grid-cols-3">
              {/* Connector line (desktop) */}
              <div className="absolute left-[16%] right-[16%] top-16 -z-10 hidden h-0.5 bg-border md:block" />

              {steps.map((step) => (
                <div key={step.title} className="flex flex-col items-center gap-4">
                  <div
                    className={`flex h-24 w-24 items-center justify-center border-2 border-border bg-card ${step.bg}`}
                  >
                    <step.icon className={`size-10 ${step.color}`} />
                  </div>
                  <h3 className="text-xl font-bold text-foreground">{step.title}</h3>
                  <p className="max-w-xs text-sm text-muted-foreground">{step.description}</p>
                </div>
              ))}
            </div>
          </m.section>

          <Separator />

          {/* ===== FAQ ===== */}
          <m.section
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mx-auto max-w-3xl py-10"
          >
            <h2 className="mb-10 text-center text-3xl font-bold text-foreground">
              Frequently Asked Questions
            </h2>
            <div className="space-y-4">
              {faqs.map((faq) => (
                <FaqItem key={faq.question} {...faq} />
              ))}
            </div>
          </m.section>
        </div>
      </div>
    </LazyMotion>
  );
}
