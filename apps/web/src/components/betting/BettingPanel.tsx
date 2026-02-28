"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PlayerSnapshot, UserBet, BettingResult, GamePhase } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface BettingPanelProps {
  players: PlayerSnapshot[];
  poolTotal: number;
  agentPools: Record<string, number>;
  bettingDeadline?: number;
  gamePhase?: GamePhase;
  winnerPublicKey?: string;
}

const BETTING_WINDOW_SECONDS = 30;

export default function BettingPanel({
  players,
  poolTotal,
  agentPools,
  bettingDeadline,
  gamePhase = "playing",
  winnerPublicKey,
}: BettingPanelProps) {
  const { connected } = useWallet();
  const [selectedAgent, setSelectedAgent] = useState("");
  const [betAmount, setBetAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [userBet, setUserBet] = useState<UserBet | null>(null);
  const [bettingResult, setBettingResult] = useState<BettingResult | null>(null);
  const [countdown, setCountdown] = useState(BETTING_WINDOW_SECONDS);
  const [bettingExpired, setBettingExpired] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activePlayers = players.filter((p) => p.status !== "folded");

  const startCountdown = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (bettingDeadline) {
      const remaining = Math.max(0, Math.floor((bettingDeadline - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) {
        setBettingExpired(true);
        return;
      }
    } else {
      setCountdown(BETTING_WINDOW_SECONDS);
    }

    setBettingExpired(false);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setBettingExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [bettingDeadline]);

  useEffect(() => {
    if (gamePhase === "playing" && !userBet) {
      startCountdown();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gamePhase, userBet, startCountdown]);

  useEffect(() => {
    if (gamePhase === "complete" && userBet && winnerPublicKey) {
      const won = userBet.agentPublicKey === winnerPublicKey;
      const agentPool = agentPools[userBet.agentPublicKey] ?? 0;
      const payout = won && agentPool > 0
        ? (userBet.amount / agentPool) * poolTotal * 0.95
        : 0;
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
    if (!selectedAgent || !betAmount || bettingExpired) return;
    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const agent = activePlayers.find((p) => p.publicKey === selectedAgent);
      setUserBet({
        agentPublicKey: selectedAgent,
        agentName: agent?.displayName ?? selectedAgent,
        amount: parseFloat(betAmount),
        timestamp: Date.now(),
      });
      if (timerRef.current) clearInterval(timerRef.current);
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
  const countdownProgress = (countdown / BETTING_WINDOW_SECONDS) * 100;

  if (gamePhase === "complete" && bettingResult) {
    return (
      <Card className="bg-zinc-900/60">
        <CardHeader className="border-b border-zinc-800 py-2 px-4">
          <CardTitle className="text-sm font-medium text-zinc-300">Betting Result</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 p-6">
          {bettingResult.won ? (
            <>
              <div className="text-4xl">{"\u{1F389}"}</div>
              <p className="text-lg font-bold text-emerald-400">
                You won {bettingResult.payout.toFixed(2)} SOL!
              </p>
              <p className="text-sm text-zinc-500">
                Your bet: {bettingResult.betAmount} SOL
              </p>
              <Button onClick={handleClaimWinnings} loading={loading}>
                Claim Winnings
              </Button>
            </>
          ) : (
            <>
              <div className="text-4xl">{"\u{1F614}"}</div>
              <p className="text-lg font-medium text-zinc-500">
                Better luck next time
              </p>
              <p className="text-sm text-zinc-600">
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
      <Card className="bg-zinc-900/60">
        <CardHeader className="border-b border-zinc-800 py-2 px-4">
          <CardTitle className="text-sm font-medium text-zinc-300">Your Bet</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3 p-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-900/40 text-2xl">
            {"\u2705"}
          </div>
          <p className="text-center text-sm text-emerald-400">
            You bet {userBet.amount} SOL on {userBet.agentName}
          </p>
          <div className="w-full rounded-lg bg-zinc-800/50 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Total Pool</span>
              <span className="font-medium text-amber-400">
                {poolTotal.toLocaleString()} SOL
              </span>
            </div>
          </div>
          <p className="text-xs text-zinc-600">
            Waiting for game to finish...
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-zinc-900/60">
      <CardHeader className="border-b border-zinc-800 py-2 px-4">
        <CardTitle className="text-sm font-medium text-zinc-300">Place Your Bet</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">Time Remaining</span>
            <span
              className={`font-mono font-medium ${
                countdown <= 10 ? "text-red-400" : "text-zinc-300"
              }`}
            >
              {countdown}s
            </span>
          </div>
          <Progress
            value={countdownProgress}
            className="h-1.5 bg-zinc-800"
            indicatorClassName={countdown <= 10 ? "bg-red-500" : "bg-emerald-500"}
          />
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">Total Pool</span>
          <span className="font-medium text-amber-400">
            {poolTotal.toLocaleString()} SOL
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Select Agent</Label>
          <div className="flex flex-col gap-1.5">
            {activePlayers.map((player) => {
              const pool = agentPools[player.publicKey] ?? 0;
              return (
                <button
                  key={player.publicKey}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedAgent === player.publicKey
                      ? "border-emerald-500 bg-emerald-900/30"
                      : "border-zinc-700 bg-zinc-800/50 hover:border-zinc-600"
                  } ${bettingExpired ? "pointer-events-none opacity-50" : ""}`}
                  onClick={() => setSelectedAgent(player.publicKey)}
                  disabled={bettingExpired}
                >
                  <span className="text-zinc-200">{player.displayName}</span>
                  <span className="text-zinc-500">{pool} SOL</span>
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
          <div className="flex items-center justify-between rounded-lg bg-emerald-900/20 px-3 py-2 text-sm">
            <span className="text-emerald-400/80">Potential Payout</span>
            <span className="font-semibold text-emerald-400">
              {potentialPayout.toFixed(2)} SOL
            </span>
          </div>
        )}

        {bettingExpired ? (
          <p className="text-center text-sm text-red-400">
            Betting window closed
          </p>
        ) : !connected ? (
          <p className="text-center text-sm text-zinc-500">
            Connect wallet to place bets
          </p>
        ) : (
          <Button
            onClick={handlePlaceBet}
            loading={loading}
            disabled={!selectedAgent || !betAmount || bettingExpired}
          >
            Place Bet
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
