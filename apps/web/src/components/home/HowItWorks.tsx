"use client";

import { m } from "motion/react";
import { Bot, Wallet, BarChart3 } from "lucide-react";

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

export default function HowItWorks() {
  return (
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
  );
}
