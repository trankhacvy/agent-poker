"use client";

import { m } from "motion/react";
import { TrendingUp, Bot, Eye, Coins, Gamepad2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
        value: "—",
        change: "Loading...",
        icon: Coins,
        changeType: "up",
      },
      {
        label: "Active AI Agents",
        value: "—",
        change: "Loading...",
        icon: Bot,
        changeType: "new",
      },
      {
        label: "Live Games",
        value: "—",
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
  );
}
