"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { m } from "motion/react";
import { Clock, Trophy, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import PokerTable from "@/components/poker/PokerTable";
import ActionFeed from "@/components/poker/ActionFeed";
import BettingPanel from "@/components/betting/BettingPanel";
import ArenaAgentCard from "@/components/arena/ArenaAgentCard";
import type { GameAction } from "@/lib/types";
import type { ArenaAgentConfig, ArenaState } from "@/lib/arena-types";
import { useBettingProgram } from "@/hooks/useBettingProgram";
import { useGameStateSubscription } from "@/hooks/useGameStateSubscription";
import { usePlayerHandsSubscription } from "@/hooks/usePlayerHandsSubscription";
import { useBettingPoolSubscription } from "@/hooks/useBettingPoolSubscription";
import { useArenaAgentStats } from "@/hooks/useArenaAgentStats";
import { deriveGamePda, derivePoolPda } from "@/lib/pda";
import { mapGameStateToSnapshot, mapPoolStatus } from "@/lib/chain-adapters";
import type { AgentActionEvent } from "@/hooks/useArenaLifecycle";
import type { Address } from "@solana/kit";

interface LiveArenaProps {
  arenaState: ArenaState;
  agents: ArenaAgentConfig[];
  agentActions: AgentActionEvent[];
  bettingCountdown: number | null;
  cooldownCountdown: number | null;
  roundNumber: number;
  tableId: string | null;
  gameId: string | null;
  lastWinner: { name: string; index: number; pot: number } | null;
  gameEnded: boolean;
  gateFailedReason: string | null;
}

export default function LiveArena({
  arenaState,
  agents,
  agentActions,
  bettingCountdown,
  cooldownCountdown,
  roundNumber,
  tableId,
  gameId,
  lastWinner,
  gameEnded,
  gateFailedReason,
}: LiveArenaProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const { placeBetOnChain } = useBettingProgram();

  const LAMPORTS_PER_SOL = 1_000_000_000;

  // ── Derive PDAs from IDs ──
  const [gamePda, setGamePda] = useState<Address | null>(null);
  const [poolPda, setPoolPda] = useState<Address | null>(null);

  useEffect(() => {
    if (gameId) {
      deriveGamePda(gameId).then(setGamePda);
    } else {
      setGamePda(null);
    }
  }, [gameId]);

  useEffect(() => {
    if (tableId) {
      derivePoolPda(tableId).then(setPoolPda);
    } else {
      setPoolPda(null);
    }
  }, [tableId]);

  // ── Subscribe to on-chain accounts ──
  const { data: onChainGameState } = useGameStateSubscription(gamePda);
  const holeCards = usePlayerHandsSubscription(gameId, 6);
  const { data: onChainPool } = useBettingPoolSubscription(poolPda);
  const agentsWithStats = useArenaAgentStats(agents);

  // ── Map on-chain GameState to UI snapshot ──
  const agentNameMap = useMemo(() => {
    const m = new Map<string, { displayName: string; template: number }>();
    for (const a of agents) {
      m.set(a.pubkey, { displayName: a.displayName, template: a.template });
    }
    return m;
  }, [agents]);

  const gameState = useMemo(() => {
    if (!onChainGameState) return null;
    return mapGameStateToSnapshot(onChainGameState, holeCards, agentNameMap);
  }, [onChainGameState, holeCards, agentNameMap]);

  // ── Pool data from chain ──
  const poolData = useMemo(() => {
    if (!onChainPool) return { totalPool: 0, agentPools: {} as Record<string, number> };
    const mapped = mapPoolStatus(onChainPool);
    return { totalPool: mapped.totalPool, agentPools: {} as Record<string, number> };
  }, [onChainPool]);

  // ── Convert agent actions to GameAction[] for ActionFeed ──
  const actions: GameAction[] = useMemo(
    () =>
      agentActions.map((a) => ({
        id: a.id,
        tableId: tableId ?? "",
        playerName: a.playerName,
        playerPublicKey: "",
        actionType: a.action.replace("_", "-") as GameAction["actionType"],
        amount: a.amount / LAMPORTS_PER_SOL,
        timestamp: a.timestamp,
        reasoning: a.reasoning,
      })),
    [agentActions, tableId]
  );

  const handlePlaceBet = useCallback(
    async (params: { wallet: string; agentPubkey: string; amount: number }) => {
      if (!tableId) throw new Error("No active betting round");

      const agentIndex = agents.findIndex((a) => a.pubkey === params.agentPubkey);
      if (agentIndex === -1) throw new Error("Invalid agent");

      const lamports = Math.round(params.amount * LAMPORTS_PER_SOL);

      // Send on-chain place_bet transaction (user signs) — that's it!
      // The BettingPool subscription will update the pool display automatically.
      const txSignature = await placeBetOnChain(tableId, agentIndex, lamports);
      if (!txSignature) throw new Error("On-chain transaction failed");

      return { success: true };
    },
    [tableId, agents, placeBetOnChain]
  );

  const winnerName =
    gameEnded && gameState?.winnerIndex != null
      ? gameState.players[gameState.winnerIndex]?.displayName
      : (lastWinner?.name ?? null);

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
        <div className="flex items-center justify-between hidden">
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
            className="flex items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3"
          >
            <span className="text-sm text-destructive">{gateFailedReason}</span>
            <span className="text-xs text-neutral-200">Starting new round...</span>
          </m.div>
        )}

        {/* Betting Phase: Agent Grid */}
        {arenaState === "betting" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-neutral-50">Pick Your Champion</h2>
              {bettingCountdown != null && (
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-violet animate-pulse" />
                  <span className="text-2xl font-bold tabular-nums text-violet">
                    {bettingCountdown}s
                  </span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {agentsWithStats.map((agent) => (
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
                className="flex items-center justify-center gap-3 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3"
              >
                <Trophy className="size-6 text-gold" />
                <span className="text-lg font-bold text-gold">{winnerName} wins!</span>
              </m.div>
            )}
            <ActionFeed actions={actions} />
          </>
        )}

        {/* Playing Phase: Loading (game being set up on-chain) */}
        {arenaState === "playing" && !gameState && !gameEnded && (
          <Card className="relative overflow-hidden p-0">
            <div className="flex aspect-video flex-col items-center justify-center gap-4">
              <span className="relative flex size-4">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet opacity-75" />
                <span className="relative inline-flex size-4 rounded-full bg-violet" />
              </span>
              <h2 className="text-xl font-bold text-neutral-50">Setting Up Game...</h2>
              <p className="max-w-xs text-center text-sm text-neutral-200">
                Creating game on-chain, seating AI agents, and shuffling the deck.
              </p>
            </div>
          </Card>
        )}

        {/* Cooldown Phase */}
        {arenaState === "cooldown" && !gameState && (
          <Card className="relative overflow-hidden p-0">
            <div className="flex aspect-video flex-col items-center justify-center gap-4">
              {lastWinner ? (
                <>
                  <Trophy className="size-10 text-gold" />
                  <h2 className="text-xl font-bold text-neutral-50">{lastWinner.name} Won!</h2>
                </>
              ) : (
                <Zap className="size-10 text-violet" />
              )}
              {cooldownCountdown != null && (
                <div className="flex items-center gap-2">
                  <span className="text-3xl font-bold tabular-nums text-violet">
                    {cooldownCountdown}s
                  </span>
                </div>
              )}
              <p className="text-sm text-neutral-200">Next round starting soon...</p>
              {/* Agent virtual balances */}
              <div className="grid grid-cols-3 gap-2 px-8 pt-2">
                {agentsWithStats.map((agent) => (
                  <div
                    key={agent.pubkey}
                    className="flex items-center gap-2 rounded-lg bg-neutral-500/50 px-3 py-1.5 text-xs"
                  >
                    <div className="size-3 rounded-full" style={{ backgroundColor: agent.color }} />
                    <span className="font-medium text-neutral-50">{agent.displayName}</span>
                    <span className="ml-auto text-neutral-200">{agent.virtualBalance ?? 100} pts</span>
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
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet opacity-75" />
                <span className="relative inline-flex size-4 rounded-full bg-violet" />
              </span>
              <h2 className="text-xl font-bold text-neutral-50">Arena Starting...</h2>
              <p className="max-w-xs text-center text-sm text-neutral-200">
                6 AI agents are warming up.
                <br /> The first betting round will begin shortly.
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
            onPlaceBet={handlePlaceBet}
          />
        ) : arenaState === "betting" ? (
          <BettingPanel
            tableId={`arena-${roundNumber}`}
            players={agentsWithStats.map((a, i) => ({
              seatIndex: i,
              publicKey: a.pubkey,
              displayName: a.displayName,
              templateId: a.template,
              chips: a.virtualBalance ?? 100,
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
            onPlaceBet={handlePlaceBet}
          />
        ) : (
          <Card className="flex h-full flex-col overflow-hidden p-0">
            <div className="border-b border-neutral-50/10 px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-50">
                Arena Betting
              </h3>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <Zap className="size-10 text-neutral-300" />
              <p className="text-sm text-neutral-200">
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
