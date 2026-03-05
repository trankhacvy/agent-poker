"use client";

import { LazyMotion, domAnimation } from "motion/react";
import { useArenaWebSocket } from "@/hooks/useArenaWebSocket";
import { useStats } from "@/hooks/queries";
import { Separator } from "@/components/ui/separator";
import StatsSection, { buildStats } from "@/components/home/StatsSection";
import HowItWorks from "@/components/home/HowItWorks";
import FaqSection from "@/components/home/FaqSection";
import LiveArena from "@/components/home/LiveArena";

export default function Home() {
  const arena = useArenaWebSocket();
  const { data: liveStats } = useStats();
  const stats = buildStats(liveStats ?? null);

  return (
    <LazyMotion features={domAnimation}>
      <div className="flex min-h-screen flex-col">
        <div className="mx-auto w-full max-w-7xl space-y-12 px-4 pb-20 pt-8">
          <LiveArena
            arenaState={arena.arenaState}
            agents={arena.agents}
            gameState={arena.gameState}
            actions={arena.actions}
            bettingCountdown={arena.bettingCountdown}
            cooldownCountdown={arena.cooldownCountdown}
            poolData={arena.poolData}
            roundNumber={arena.roundNumber}
            lastWinner={arena.lastWinner}
            gameEnded={arena.gameEnded}
            gateFailedReason={arena.gateFailedReason}
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
