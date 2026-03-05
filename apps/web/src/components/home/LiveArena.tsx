"use client";

import { useState } from "react";
import { m } from "motion/react";
import { Clock, Trophy, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import PokerTable from "@/components/poker/PokerTable";
import ActionFeed from "@/components/poker/ActionFeed";
import BettingPanel from "@/components/betting/BettingPanel";
import ArenaAgentCard from "@/components/arena/ArenaAgentCard";
import type { GameStateSnapshot, GameAction } from "@/lib/types";
import type { ArenaAgentConfig, ArenaState, ArenaPoolData } from "@/lib/arena-types";

interface LiveArenaProps {
  arenaState: ArenaState;
  agents: ArenaAgentConfig[];
  gameState: GameStateSnapshot | null;
  actions: GameAction[];
  bettingCountdown: number | null;
  cooldownCountdown: number | null;
  poolData: ArenaPoolData;
  roundNumber: number;
  lastWinner: { name: string; index: number; pot: number } | null;
  gameEnded: boolean;
  gateFailedReason: string | null;
}

export default function LiveArena({
  arenaState,
  agents,
  gameState,
  actions,
  bettingCountdown,
  cooldownCountdown,
  poolData,
  roundNumber,
  lastWinner,
  gameEnded,
  gateFailedReason,
}: LiveArenaProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const winnerName =
    gameEnded && gameState?.winnerIndex != null
      ? gameState.players[gameState.winnerIndex]?.displayName
      : lastWinner?.name ?? null;

  const winnerPublicKey =
    gameEnded && gameState?.winnerIndex != null
      ? gameState.players[gameState.winnerIndex]?.publicKey
      : undefined;

  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="grid grid-cols-1 gap-6 lg:grid-cols-12"
    >
      {/* --- Main Area (Left) --- */}
      <div className="flex flex-col gap-4 lg:col-span-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              Round #{roundNumber}
            </Badge>
            <Badge
              variant={arenaState === "playing" ? "default" : "secondary"}
              className="text-xs capitalize"
            >
              {arenaState === "idle" ? "Starting..." : arenaState}
            </Badge>
          </div>
        </div>

        {/* Gate Failed Flash */}
        {gateFailedReason && arenaState === "refunding" && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-center gap-2 border-2 border-destructive/30 bg-destructive/10 px-4 py-3"
          >
            <span className="text-sm text-destructive">{gateFailedReason}</span>
            <span className="text-xs text-muted-foreground">Starting new round...</span>
          </m.div>
        )}

        {/* Betting Phase: Agent Grid */}
        {arenaState === "betting" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Pick Your Champion</h2>
              {bettingCountdown != null && (
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-primary animate-pulse" />
                  <span className="text-2xl font-bold tabular-nums text-primary">
                    {bettingCountdown}s
                  </span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {agents.map((agent) => (
                <ArenaAgentCard
                  key={agent.pubkey}
                  agent={agent}
                  poolAmount={poolData.agentPools[agent.pubkey] ?? 0}
                  isSelected={selectedAgent === agent.pubkey}
                  onSelect={setSelectedAgent}
                />
              ))}
            </div>
          </div>
        )}

        {/* Playing Phase: Poker Table */}
        {(arenaState === "playing" || (gameEnded && gameState)) && gameState && (
          <>
            <PokerTable
              gameState={gameState}
              actions={actions}
              gameEnded={gameEnded}
              nextGameCountdown={cooldownCountdown}
            />
            {/* Winner banner */}
            {gameEnded && winnerName && (
              <m.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center justify-center gap-3 border-2 border-secondary bg-secondary/10 px-4 py-3"
              >
                <Trophy className="size-6 text-secondary" />
                <span className="text-lg font-bold text-secondary">
                  {winnerName} wins!
                </span>
              </m.div>
            )}
            <ActionFeed actions={actions} />
          </>
        )}

        {/* Cooldown Phase */}
        {arenaState === "cooldown" && !gameState && (
          <Card className="relative overflow-hidden p-0">
            <div className="flex aspect-video flex-col items-center justify-center gap-4">
              {lastWinner ? (
                <>
                  <Trophy className="size-10 text-secondary" />
                  <h2 className="text-xl font-bold text-foreground">
                    {lastWinner.name} Won!
                  </h2>
                </>
              ) : (
                <Zap className="size-10 text-primary" />
              )}
              {cooldownCountdown != null && (
                <div className="flex items-center gap-2">
                  <span className="text-3xl font-bold tabular-nums text-primary">
                    {cooldownCountdown}s
                  </span>
                </div>
              )}
              <p className="text-sm text-muted-foreground">Next round starting soon...</p>
              {/* Agent virtual balances */}
              <div className="grid grid-cols-3 gap-2 px-8 pt-2">
                {agents.map((agent) => (
                  <div
                    key={agent.pubkey}
                    className="flex items-center gap-2 rounded bg-muted px-3 py-1.5 text-xs"
                  >
                    <div
                      className="size-3 rounded-full"
                      style={{ backgroundColor: agent.color }}
                    />
                    <span className="font-medium">{agent.displayName}</span>
                    <span className="ml-auto text-muted-foreground">
                      {agent.virtualBalance} pts
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Idle / Waiting */}
        {arenaState === "idle" && !gateFailedReason && (
          <Card className="relative overflow-hidden p-0">
            <div className="flex aspect-video flex-col items-center justify-center gap-4">
              <span className="relative flex size-4">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex size-4 rounded-full bg-primary" />
              </span>
              <h2 className="text-xl font-bold text-foreground">Arena Starting...</h2>
              <p className="max-w-xs text-center text-sm text-muted-foreground">
                6 AI agents are warming up. The first betting round will begin shortly.
              </p>
            </div>
          </Card>
        )}
      </div>

      {/* --- Side Panel (Right) --- */}
      <div className="flex flex-col lg:col-span-4">
        {gameState && (arenaState === "playing" || gameEnded) ? (
          <BettingPanel
            tableId={gameState.tableId}
            players={gameState.players}
            poolTotal={poolData.totalPool}
            agentPools={poolData.agentPools}
            gamePhase={gameEnded ? "complete" : "playing"}
            winnerPublicKey={winnerPublicKey}
            bettingCountdown={bettingCountdown}
            bettingLocked={arenaState === "playing"}
          />
        ) : arenaState === "betting" ? (
          <BettingPanel
            tableId={`arena-${roundNumber}`}
            players={agents.map((a, i) => ({
              seatIndex: i,
              publicKey: a.pubkey,
              displayName: a.displayName,
              templateId: a.template,
              chips: a.virtualBalance,
              currentBet: 0,
              cards: [-1, -1],
              status: "active" as const,
              isDealer: i === 0,
            }))}
            poolTotal={poolData.totalPool}
            agentPools={poolData.agentPools}
            gamePhase="playing"
            bettingCountdown={bettingCountdown}
            bettingLocked={false}
          />
        ) : (
          <Card className="flex h-full flex-col overflow-hidden border-border bg-card p-0">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                Arena Betting
              </h3>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <Zap className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {arenaState === "cooldown"
                  ? "Betting opens when the next round starts."
                  : "Arena is starting up. Betting will open soon."}
              </p>
            </div>
          </Card>
        )}
      </div>
    </m.div>
  );
}
