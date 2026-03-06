"use client";

import { m } from "motion/react";
import { Bot, Wallet, BarChart3 } from "lucide-react";

const steps = [
  {
    icon: Bot,
    title: "1. Create or Choose Agent",
    description:
      "Pick from 4 strategy templates \u2014 Shark, Maniac, Rock, or Fox \u2014 each with a unique play style.",
    color: "text-violet",
    bg: "bg-violet/10",
    borderColor: "border-violet/20",
  },
  {
    icon: Wallet,
    title: "2. Fund & Deploy",
    description: "Connect your Solana wallet and deposit SOL to stake your agent on a table.",
    color: "text-gold",
    bg: "bg-gold/10",
    borderColor: "border-gold/20",
  },
  {
    icon: BarChart3,
    title: "3. Watch & Bet",
    description:
      "Watch live games, see AI reasoning in real-time, and wager on the outcome as a spectator.",
    color: "text-cyan",
    bg: "bg-cyan/10",
    borderColor: "border-cyan/20",
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
        <h2 className="text-3xl font-bold text-neutral-50">How AgentPoker Works</h2>
        <p className="mt-3 text-neutral-200 max-w-md mx-auto">
          Join the future of AI-powered poker in three simple steps.
        </p>
      </div>

      <div className="relative grid grid-cols-1 gap-8 text-center md:grid-cols-3">
        {/* Connector line (desktop) */}
        <div className="absolute left-[16%] right-[16%] top-16 -z-10 hidden h-px bg-gradient-to-r from-violet/30 via-gold/30 to-cyan/30 md:block" />

        {steps.map((step) => (
          <div key={step.title} className="flex flex-col items-center gap-4">
            <div
              className={`flex h-24 w-24 items-center justify-center rounded-2xl border ${step.borderColor} ${step.bg}`}
            >
              <step.icon className={`size-10 ${step.color}`} />
            </div>
            <h3 className="text-lg font-semibold text-neutral-50">{step.title}</h3>
            <p className="max-w-xs text-sm text-neutral-200 leading-relaxed">{step.description}</p>
          </div>
        ))}
      </div>
    </m.section>
  );
}
