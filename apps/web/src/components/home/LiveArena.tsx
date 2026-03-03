"use client";

import Link from "next/link";
import { m } from "motion/react";
import { Video, Coins, Clock, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import PokerTable from "@/components/poker/PokerTable";
import ActionFeed from "@/components/poker/ActionFeed";
import BettingPanel from "@/components/betting/BettingPanel";
import type { GameStateSnapshot, GameAction } from "@/lib/types";

interface LiveArenaProps {
  activeTableId: string | null;
  gameState: GameStateSnapshot | null;
  actions: GameAction[];
  poolTotal: number;
  agentPools: Record<string, number>;
  bettingCountdown: number | null;
  bettingLocked: boolean;
  nextGameCountdown: number | null;
  gameEnded: boolean;
}

export default function LiveArena({
  activeTableId,
  gameState,
  actions,
  poolTotal,
  agentPools,
  bettingCountdown,
  bettingLocked,
  nextGameCountdown,
  gameEnded,
}: LiveArenaProps) {
  const hasLiveGame = activeTableId && gameState;

  // Determine winner name for post-game display
  const winnerName =
    gameEnded && gameState?.winnerIndex != null
      ? gameState.players[gameState.winnerIndex]?.displayName
      : null;

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
      {/* --- Main Poker Table Area (Left) --- */}
      <div className="flex flex-col gap-4 lg:col-span-8">
        {hasLiveGame ? (
          <>
            <PokerTable
              gameState={gameState}
              actions={actions}
              gameEnded={gameEnded}
              nextGameCountdown={nextGameCountdown}
            />
            {/* Winner banner */}
            {gameEnded && winnerName && (
              <m.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center justify-center gap-3 border-2 border-secondary bg-secondary/10 px-4 py-3"
              >
                <span className="text-2xl">{"\u{1F3C6}"}</span>
                <span className="text-lg font-bold text-secondary">
                  {winnerName} wins {gameState.pot} SOL!
                </span>
              </m.div>
            )}
            <ActionFeed actions={actions} />
          </>
        ) : nextGameCountdown != null && nextGameCountdown > 0 ? (
          /* Countdown to next game */
          <Card className="relative overflow-hidden p-0">
            <div className="flex aspect-video flex-col items-center justify-center gap-4">
              <Clock className="size-10 text-primary animate-pulse" />
              <h2 className="text-xl font-bold text-foreground">Matching Agents...</h2>
              <div className="flex items-center gap-2">
                <span className="text-4xl font-bold tabular-nums text-primary">
                  {nextGameCountdown}s
                </span>
              </div>
              <p className="max-w-xs text-center text-sm text-muted-foreground">
                Agents are being queued. A new match will begin shortly.
              </p>
            </div>
          </Card>
        ) : (
          /* No live game fallback */
          <Card className="relative overflow-hidden p-0">
            <div className="flex aspect-video flex-col items-center justify-center gap-4">
              <span className="relative flex size-4">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-muted-foreground opacity-75" />
                <span className="relative inline-flex size-4 rounded-full bg-muted-foreground" />
              </span>
              <h2 className="text-xl font-bold text-foreground">No Live Games</h2>
              <p className="max-w-xs text-center text-sm text-muted-foreground">
                Games appear here when agents are matched. Create an agent or browse tables to get
                started.
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
            gamePhase={gameEnded ? "complete" : "playing"}
            winnerPublicKey={winnerPublicKey}
            bettingCountdown={bettingCountdown}
            bettingLocked={bettingLocked}
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
                {nextGameCountdown != null && nextGameCountdown > 0
                  ? "Betting will open when the next game starts."
                  : "Betting opens when a live game starts. Watch agents battle and wager on the winner."}
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
  );
}
