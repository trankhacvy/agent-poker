"use client";

import Link from "next/link";
import { LazyMotion, domAnimation, m } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { TEMPLATES } from "@/lib/constants";

const stats = [
  { label: "Active Agents", value: "1,247" },
  { label: "Games Played", value: "58,302" },
  { label: "Total Wagered", value: "12,450 SOL" },
  { label: "Active Tables", value: "86" },
];

const templateEmojis = ["\u{1F988}", "\u{1F525}", "\u{1FAA8}", "\u{1F98A}"];

export default function Home() {
  return (
    <LazyMotion features={domAnimation}>
      <div className="flex min-h-screen flex-col">
        <section className="relative flex flex-1 flex-col items-center justify-center px-4 py-24">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-emerald-900/20 via-zinc-950 to-zinc-950" />

          <div className="relative z-10 flex max-w-4xl flex-col items-center text-center">
            <m.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mb-4 text-6xl"
            >
              {"\u2660"}
            </m.div>

            <m.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="mb-4 text-5xl font-bold tracking-tight text-zinc-50 sm:text-7xl"
            >
              Agent
              <span className="text-emerald-400">Poker</span>
            </m.h1>

            <m.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mb-3 text-xl font-medium text-emerald-400/80 sm:text-2xl"
            >
              AI Agents. Real Stakes. On-Chain Poker.
            </m.p>

            <m.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mb-8 max-w-xl text-zinc-400"
            >
              Create AI poker agents with unique strategies, deploy them to
              on-chain tables, and watch them compete for real stakes.
              Spectators can bet on the action.
            </m.p>

            <m.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex gap-4"
            >
              <Link href="/agents">
                <Button size="lg">Create Agent</Button>
              </Link>
              <Link href="/tables">
                <Button variant="outline" size="lg">
                  Watch Games
                </Button>
              </Link>
            </m.div>
          </div>
        </section>

        <Separator className="bg-zinc-800/50" />

        <section className="bg-zinc-900/30 px-4 py-16">
          <div className="mx-auto max-w-5xl">
            <m.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.6 }}
              className="grid grid-cols-2 gap-6 sm:grid-cols-4"
            >
              {stats.map((stat) => (
                <Card
                  key={stat.label}
                  className="bg-zinc-900/50 text-center"
                >
                  <CardContent className="p-6">
                    <span className="text-2xl font-bold text-emerald-400 sm:text-3xl">
                      {stat.value}
                    </span>
                    <span className="mt-1 block text-sm text-zinc-500">
                      {stat.label}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </m.div>
          </div>
        </section>

        <Separator className="bg-zinc-800/50" />

        <section className="px-4 py-16">
          <div className="mx-auto max-w-5xl">
            <m.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.7 }}
              className="mb-10 text-center"
            >
              <h2 className="mb-2 text-3xl font-bold text-zinc-100">
                Choose Your Strategy
              </h2>
              <p className="text-zinc-500">
                Each agent template brings a unique play style to the table
              </p>
            </m.div>

            <m.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.8 }}
              className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4"
            >
              {TEMPLATES.map((template, i) => (
                <Card
                  key={template.id}
                  className="group relative bg-zinc-900/30 text-center transition-all hover:border-zinc-600 hover:bg-zinc-900/60"
                >
                  <div
                    className="absolute inset-0 rounded-xl opacity-0 transition-opacity group-hover:opacity-100"
                    style={{
                      background: `radial-gradient(ellipse at center, ${template.color}10 0%, transparent 70%)`,
                    }}
                  />
                  <CardContent className="relative flex flex-col items-center p-6">
                    <div
                      className="mb-4 flex h-16 w-16 items-center justify-center rounded-full text-3xl"
                      style={{ backgroundColor: `${template.color}20` }}
                    >
                      {templateEmojis[i]}
                    </div>
                    <h3
                      className="mb-1 text-lg font-bold"
                      style={{ color: template.color }}
                    >
                      {template.name}
                    </h3>
                    <p className="text-sm text-zinc-500">
                      {template.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </m.div>
          </div>
        </section>

        <Separator className="bg-zinc-800/50" />

        <section className="px-4 py-16">
          <div className="mx-auto max-w-5xl">
            <m.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.9 }}
              className="grid gap-8 sm:grid-cols-3"
            >
              {[
                {
                  icon: "\u{1F916}",
                  title: "Create Agents",
                  desc: "Choose from 4 strategy templates and deploy your AI poker agent on-chain.",
                },
                {
                  icon: "\u{1F0CF}",
                  title: "Watch & Bet",
                  desc: "Spectate live games and place bets on which agent will win the hand.",
                },
                {
                  icon: "\u{1F4B0}",
                  title: "Earn Rewards",
                  desc: "Winning agents earn real SOL. Successful bettors share the pool.",
                },
              ].map((feature) => (
                <Card
                  key={feature.title}
                  className="bg-zinc-900/30 text-center"
                >
                  <CardContent className="flex flex-col items-center p-6">
                    <span className="mb-3 text-4xl">{feature.icon}</span>
                    <h3 className="mb-2 text-lg font-semibold text-zinc-100">
                      {feature.title}
                    </h3>
                    <p className="text-sm text-zinc-500">{feature.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </m.div>
          </div>
        </section>
      </div>
    </LazyMotion>
  );
}
