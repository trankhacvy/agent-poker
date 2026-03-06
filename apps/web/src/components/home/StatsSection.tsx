"use client";

import { m } from "motion/react";
import { TrendingUp, Bot, Eye, Coins, Gamepad2 } from "lucide-react";
import { lamportsToSol } from "@solana/connector";
import type { StatsData } from "@/lib/api";
import type { LucideIcon } from "lucide-react";

interface StatItem {
  label: string;
  value: string;
  change: string;
  icon: LucideIcon;
  changeType: "up" | "new" | "views";
}

export function buildStats(data: StatsData | null): StatItem[] {
  if (!data) {
    return [
      {
        label: "Total Volume Wagered",
        value: "---",
        change: "Loading...",
        icon: Coins,
        changeType: "up",
      },
      {
        label: "Active AI Agents",
        value: "---",
        change: "Loading...",
        icon: Bot,
        changeType: "new",
      },
      {
        label: "Live Games",
        value: "---",
        change: "Loading...",
        icon: Gamepad2,
        changeType: "views",
      },
    ];
  }
  return [
    {
      label: "Total Volume Wagered",
      value: `${lamportsToSol(data.totalVolume).toLocaleString()} SOL`,
      change: `${data.totalGamesPlayed} games played`,
      icon: Coins,
      changeType: "up",
    },
    {
      label: "Active AI Agents",
      value: data.totalAgents.toLocaleString(),
      change: `${data.totalAgents} registered`,
      icon: Bot,
      changeType: "new",
    },
    {
      label: "Live Games",
      value: data.activeGames.toLocaleString(),
      change: `${data.totalGamesPlayed} total`,
      icon: Gamepad2,
      changeType: "views",
    },
  ];
}

interface StatsSectionProps {
  stats: StatItem[];
}

export default function StatsSection({ stats }: StatsSectionProps) {
  return (
    <m.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="grid grid-cols-1 gap-6 md:grid-cols-3"
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="relative rounded-2xl bg-neutral-600 border border-neutral-50/10 p-6 overflow-hidden"
        >
          {/* Subtle gradient accent */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-violet/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="relative">
            <stat.icon className="absolute right-0 top-0 size-10 text-neutral-500" />
            <p className="text-sm font-medium text-neutral-200">{stat.label}</p>
            <h3 className="mt-2 text-3xl font-bold text-neutral-50">{stat.value}</h3>
            <div className="mt-3 flex items-center gap-1.5 text-xs font-medium">
              {stat.changeType === "up" && <TrendingUp className="size-3 text-green" />}
              {stat.changeType === "new" && <Bot className="size-3 text-violet" />}
              {stat.changeType === "views" && <Eye className="size-3 text-gold" />}
              <span
                className={
                  stat.changeType === "up"
                    ? "text-green"
                    : stat.changeType === "new"
                      ? "text-violet"
                      : "text-gold"
                }
              >
                {stat.change}
              </span>
            </div>
          </div>
        </div>
      ))}
    </m.div>
  );
}
