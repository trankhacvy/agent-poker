"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PlayerSnapshot, UserBet, BettingResult, GamePhase } from "@/lib/types";
import { placeBet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const BETTING_WINDOW_TOTAL = 60;

interface BettingPanelProps {
  tableId: string;
  players: PlayerSnapshot[];
  poolTotal: number;
  agentPools: Record<string, number>;
  gamePhase?: GamePhase;
  winnerPublicKey?: string;
  bettingCountdown: number | null;
  bettingLocked: boolean;
}

export default function BettingPanel({
  tableId,
  players,
  poolTotal,
  agentPools,
  gamePhase = "playing",
  winnerPublicKey,
  bettingCountdown,
  bettingLocked,
}: BettingPanelProps) {
  const { connected, publicKey } = useWallet();
  const [selectedAgent, setSelectedAgent] = useState("");
  const [betAmount, setBetAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userBet, setUserBet] = useState<UserBet | null>(null);
  const [bettingResult, setBettingResult] = useState<BettingResult | null>(null);

  const activePlayers = players.filter((p) => p.status !== "folded");

  // Derive UI state from WebSocket-driven props
  const bettingExpired = bettingLocked || bettingCountdown === 0;
  const countdown = bettingCountdown ?? 0;
  const countdownProgress = bettingCountdown != null ? (bettingCountdown / BETTING_WINDOW_TOTAL) * 100 : 0;

  useEffect(() => {
    if (gamePhase === "complete" && userBet && winnerPublicKey) {
      const won = userBet.agentPublicKey === winnerPublicKey;
      const agentPool = agentPools[userBet.agentPublicKey] ?? 0;
      const payout = won && agentPool > 0 ? (userBet.amount / agentPool) * poolTotal * 0.95 : 0;
      setBettingResult({ won, payout, betAmount: userBet.amount });
    }
  }, [gamePhase, userBet, winnerPublicKey, agentPools, poolTotal]);

  function calculatePotentialPayout(): number {
    const bet = parseFloat(betAmount);
    if (!bet || !selectedAgent || bet <= 0) return 0;
    const agentPool = (agentPools[selectedAgent] ?? 0) + bet;
    const total = poolTotal + bet;
    return (bet / agentPool) * total * 0.95;
  }

  async function handlePlaceBet() {
    if (!selectedAgent || !betAmount || bettingExpired || !publicKey) return;
    setLoading(true);
    setError(null);
    try {
      await placeBet({
        tableId,
        wallet: publicKey.toBase58(),
        agentPubkey: selectedAgent,
        amount: parseFloat(betAmount),
      });
      const agent = activePlayers.find((p) => p.publicKey === selectedAgent);
      setUserBet({
        agentPublicKey: selectedAgent,
        agentName: agent?.displayName ?? selectedAgent,
        amount: parseFloat(betAmount),
        timestamp: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to place bet");
    } finally {
      setLoading(false);
    }
  }

  async function handleClaimWinnings() {
    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } finally {
      setLoading(false);
    }
  }

  const potentialPayout = calculatePotentialPayout();

  // Spectator result view: game complete but user didn't bet
  if (gamePhase === "complete" && !userBet) {
    const winnerPlayer = players.find((p) => p.publicKey === winnerPublicKey);
    return (
      <Card>
        <CardHeader className="border-b border-border py-2 px-4">
          <CardTitle className="text-sm font-medium text-foreground">Game Result</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-center gap-2 py-2">
            <span className="text-2xl">{"\u{1F3C6}"}</span>
            <span className="text-lg font-bold text-secondary">
              {winnerPlayer?.displayName ?? "Unknown"} wins!
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {players.map((player) => {
              const pool = agentPools[player.publicKey] ?? 0;
              const isWinner = player.publicKey === winnerPublicKey;
              return (
                <div
                  key={player.publicKey}
                  className={`flex items-center justify-between px-3 py-2 text-sm border-2 ${
                    isWinner
                      ? "border-secondary bg-secondary/10"
                      : "border-border bg-muted"
                  }`}
                >
                  <span className="text-foreground">
                    {isWinner && "\u{1F451} "}{player.displayName}
                  </span>
                  <span className="text-muted-foreground">{pool} SOL</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-sm pt-1">
            <span className="text-muted-foreground">Total Pool</span>
            <span className="font-medium text-secondary">{poolTotal.toLocaleString()} SOL</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (gamePhase === "complete" && bettingResult) {
    return (
      <Card>
        <CardHeader className="border-b border-border py-2 px-4">
          <CardTitle className="text-sm font-medium text-foreground">Betting Result</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 p-6">
          {bettingResult.won ? (
            <>
              <div className="text-4xl">{"\u{1F389}"}</div>
              <p className="text-lg font-bold text-primary">
                You won {bettingResult.payout.toFixed(2)} SOL!
              </p>
              <p className="text-sm text-muted-foreground">
                Your bet: {bettingResult.betAmount} SOL
              </p>
              <Button onClick={handleClaimWinnings} disabled={loading}>
                {loading ? "Claiming..." : "Claim Winnings"}
              </Button>
            </>
          ) : (
            <>
              <div className="text-4xl">{"\u{1F614}"}</div>
              <p className="text-lg font-medium text-muted-foreground">Better luck next time</p>
              <p className="text-sm text-muted-foreground">
                You bet {bettingResult.betAmount} SOL on {userBet?.agentName}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  if (userBet) {
    return (
      <Card>
        <CardHeader className="border-b border-border py-2 px-4">
          <CardTitle className="text-sm font-medium text-foreground">Your Bet</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3 p-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-2xl">
            {"\u2705"}
          </div>
          <p className="text-center text-sm text-primary">
            You bet {userBet.amount} SOL on {userBet.agentName}
          </p>
          <div className="w-full border-2 border-border bg-muted p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total Pool</span>
              <span className="font-medium text-secondary">{poolTotal.toLocaleString()} SOL</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Waiting for game to finish...</p>
        </CardContent>
      </Card>
    );
  }

  // Locked-betting pool summary: betting closed but user didn't bet
  if (bettingExpired && !userBet) {
    return (
      <Card>
        <CardHeader className="border-b border-border py-2 px-4">
          <CardTitle className="text-sm font-medium text-foreground">Betting Pool</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total Pool</span>
            <span className="font-medium text-secondary">{poolTotal.toLocaleString()} SOL</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {activePlayers.map((player) => {
              const pool = agentPools[player.publicKey] ?? 0;
              return (
                <div
                  key={player.publicKey}
                  className="flex items-center justify-between px-3 py-2 text-sm border-2 border-border bg-muted"
                >
                  <span className="text-foreground">{player.displayName}</span>
                  <span className="text-muted-foreground">{pool} SOL</span>
                </div>
              );
            })}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Betting window closed. Watching game...
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b border-border py-2 px-4">
        <CardTitle className="text-sm font-medium text-foreground">Place Your Bet</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Time Remaining</span>
            <span
              className={` font-medium ${countdown <= 5 ? "text-destructive" : "text-foreground"}`}
            >
              {countdown}s
            </span>
          </div>
          <Progress value={countdownProgress} className="h-1.5" />
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total Pool</span>
          <span className="font-medium text-secondary">{poolTotal.toLocaleString()} SOL</span>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Select Agent</Label>
          <div className="flex flex-col gap-1.5">
            {activePlayers.map((player) => {
              const pool = agentPools[player.publicKey] ?? 0;
              return (
                <button
                  key={player.publicKey}
                  className={`flex items-center justify-between border-2 px-3 py-2 text-left text-sm transition-colors ${
                    selectedAgent === player.publicKey
                      ? "border-primary bg-primary/10"
                      : "border-border bg-muted hover:border-muted-foreground"
                  } ${bettingExpired ? "pointer-events-none opacity-50" : ""}`}
                  onClick={() => setSelectedAgent(player.publicKey)}
                  disabled={bettingExpired}
                >
                  <span className="text-foreground">{player.displayName}</span>
                  <span className="text-muted-foreground">{pool} SOL</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Bet Amount (SOL)</Label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={betAmount}
            onChange={(e) => setBetAmount(e.target.value)}
            placeholder="0.1"
            disabled={bettingExpired}
          />
        </div>

        {potentialPayout > 0 && (
          <div className="flex items-center justify-between border-2 border-border bg-primary/10 px-3 py-2 text-sm">
            <span className="text-primary/80">Potential Payout</span>
            <span className="font-semibold text-primary">{potentialPayout.toFixed(2)} SOL</span>
          </div>
        )}

        {error && <p className="text-center text-sm text-destructive">{error}</p>}

        {bettingExpired ? (
          <p className="text-center text-sm text-destructive">Betting window closed</p>
        ) : !connected ? (
          <p className="text-center text-sm text-muted-foreground">Connect wallet to place bets</p>
        ) : (
          <Button
            onClick={handlePlaceBet}
            disabled={!selectedAgent || !betAmount || bettingExpired || loading}
          >
            {loading ? "Placing Bet..." : "Place Bet"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
