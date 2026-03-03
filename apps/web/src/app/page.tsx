"use client";

import { useEffect, useRef, useState } from "react";
import { LazyMotion, domAnimation } from "motion/react";
import { fetchBettingPool } from "@/lib/api";
import { useGameWebSocket } from "@/hooks/useGameWebSocket";
import { useStats, useTables } from "@/hooks/queries";
import { Separator } from "@/components/ui/separator";
import StatsSection, { buildStats } from "@/components/home/StatsSection";
import HowItWorks from "@/components/home/HowItWorks";
import FaqSection from "@/components/home/FaqSection";
import LiveArena from "@/components/home/LiveArena";

export default function Home() {
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [poolTotal, setPoolTotal] = useState(0);
  const [agentPools, setAgentPools] = useState<Record<string, number>>({});

  const {
    gameState,
    actions,
    bettingCountdown,
    bettingLocked,
    poolData,
    nextGameCountdown,
    gameEnded,
    subscribe,
  } = useGameWebSocket();

  const { data: liveStats } = useStats();
  const { data: tables } = useTables();

  // Track which table we've subscribed to, so we don't re-subscribe on every poll
  const subscribedRef = useRef<string | null>(null);

  // Discover active table when tables data updates
  useEffect(() => {
    if (!tables) return;
    const active = tables.find((t) => t.status === "in-progress");
    if (active) {
      setActiveTableId(active.tableId);
      if (subscribedRef.current !== active.tableId) {
        subscribedRef.current = active.tableId;
        subscribe(active.tableId);
        fetchBettingPool(active.tableId).then((pool) => {
          setPoolTotal(pool.totalPool);
          setAgentPools(pool.agentPools);
        });
      }
    } else if (!gameEnded) {
      // Only clear when game is NOT in the post-game display phase
      setActiveTableId(null);
      subscribedRef.current = null;
    }
  }, [tables, subscribe, gameEnded]);

  // Sync WebSocket pool updates into local state
  useEffect(() => {
    if (poolData) {
      setPoolTotal(poolData.totalPool);
      setAgentPools(poolData.agentPools);
    }
  }, [poolData]);

  const stats = buildStats(liveStats ?? null);

  return (
    <LazyMotion features={domAnimation}>
      <div className="flex min-h-screen flex-col">
        <div className="mx-auto w-full max-w-7xl space-y-12 px-4 pb-20 pt-8">
          <LiveArena
            activeTableId={activeTableId}
            gameState={gameState}
            actions={actions}
            poolTotal={poolTotal}
            agentPools={agentPools}
            bettingCountdown={bettingCountdown}
            bettingLocked={bettingLocked}
            nextGameCountdown={nextGameCountdown}
            gameEnded={gameEnded}
          />
          <StatsSection stats={stats} />
          <Separator />
          <HowItWorks />
          <Separator />
          <FaqSection />
        </div>
      </div>
    </LazyMotion>
  );
}
