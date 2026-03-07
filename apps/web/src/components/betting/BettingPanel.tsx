"use client";

import { useEffect, useState } from "react";
import { useAccount } from "@solana/connector";
import type { PlayerSnapshot, UserBet, BettingResult, GamePhase } from "@/lib/types";
import { placeBet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { TEMPLATES } from "@/lib/constants";

type PlaceBetFn = (params: {
  wallet: string;
  agentPubkey: string;
  amount: number;
}) => Promise<{ success: boolean }>;

const BETTING_WINDOW_TOTAL = 60;
const PAYOUT_MULTIPLIER = 5.7; // 6 agents * 0.95 rake

interface BettingPanelProps {
  tableId: string;
  players: PlayerSnapshot[];
  poolTotal: number;
  agentPools: Record<string, number>;
  gamePhase?: GamePhase;
  winnerPublicKey?: string;
  bettingCountdown: number | null;
  bettingLocked: boolean;
  onPlaceBet?: PlaceBetFn;
  onClaimWinnings?: () => Promise<string>;
  userBet?: UserBet | null;
  onUserBetChange?: (bet: UserBet | null) => void;
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
  onPlaceBet,
  onClaimWinnings,
  userBet: externalUserBet,
  onUserBetChange,
}: BettingPanelProps) {
  const { address: walletAddress, connected } = useAccount();
  const [selectedAgent, setSelectedAgent] = useState("");
  const [betAmount, setBetAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [internalUserBet, setInternalUserBet] = useState<UserBet | null>(null);
  const [bettingResult, setBettingResult] = useState<BettingResult | null>(null);
  const [claimed, setClaimed] = useState(false);

  // Use external state if provided, otherwise use internal
  const userBet = externalUserBet !== undefined ? externalUserBet : internalUserBet;
  const setUserBet = (bet: UserBet | null) => {
    setInternalUserBet(bet);
    onUserBetChange?.(bet);
  };

  const activePlayers = players.filter((p) => p.status !== "folded");

  const bettingExpired = bettingLocked || bettingCountdown === 0;
  const countdown = bettingCountdown ?? 0;
  const countdownProgress = bettingCountdown != null ? (bettingCountdown / BETTING_WINDOW_TOTAL) * 100 : 0;

  useEffect(() => {
    if (gamePhase === "complete" && userBet && winnerPublicKey) {
      const won = userBet.agentPublicKey === winnerPublicKey;
      const payout = won ? userBet.amount * PAYOUT_MULTIPLIER : 0;
      setBettingResult({ won, payout, betAmount: userBet.amount });
    }
  }, [gamePhase, userBet, winnerPublicKey]);

  function calculatePotentialPayout(): number {
    const bet = parseFloat(betAmount);
    if (!bet || !selectedAgent || bet <= 0) return 0;
    return bet * PAYOUT_MULTIPLIER;
  }

  async function handlePlaceBet() {
    if (!selectedAgent || !betAmount || bettingExpired || !walletAddress) return;
    setLoading(true);
    setError(null);
    try {
      const wallet = walletAddress;
      const amount = parseFloat(betAmount);
      if (onPlaceBet) {
        await onPlaceBet({ wallet, agentPubkey: selectedAgent, amount });
      } else {
        await placeBet({ tableId, wallet, agentPubkey: selectedAgent, amount });
      }
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
    if (!onClaimWinnings) return;
    setLoading(true);
    setError(null);
    try {
      await onClaimWinnings();
      setClaimed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to claim winnings");
    } finally {
      setLoading(false);
    }
  }

  const potentialPayout = calculatePotentialPayout();

  // Spectator result view
  if (gamePhase === "complete" && !userBet) {
    const winnerPlayer = players.find((p) => p.publicKey === winnerPublicKey);
    return (
      <div className="rounded-2xl border border-neutral-50/10 bg-neutral-600 overflow-hidden">
        <div className="border-b border-neutral-50/10 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-50">Game Result</h3>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-center gap-2 py-2">
            <span className="text-2xl">{"\u{1F3C6}"}</span>
            <span className="text-lg font-bold text-gold">
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
                  className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${
                    isWinner
                      ? "border border-gold/30 bg-gold/10"
                      : "bg-neutral-500/50"
                  }`}
                >
                  <span className="flex items-center gap-2 text-neutral-50">
                    {isWinner && "\u{1F451} "}
                    <img src={TEMPLATES[player.templateId]?.avatar ?? "/icon.png"} alt={player.displayName} className="size-5 rounded-full object-cover" />
                    {player.displayName}
                  </span>
                  <span className="text-neutral-200">{pool} SOL</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-sm pt-1">
            <span className="text-neutral-200">Total Pool</span>
            <span className="font-medium text-gold">{poolTotal.toLocaleString()} SOL</span>
          </div>
        </div>
      </div>
    );
  }

  if (gamePhase === "complete" && bettingResult) {
    return (
      <div className="rounded-2xl border border-neutral-50/10 bg-neutral-600 overflow-hidden">
        <div className="border-b border-neutral-50/10 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-50">Betting Result</h3>
        </div>
        <div className="flex flex-col items-center gap-4 p-6">
          {bettingResult.won ? (
            <>
              <div className="text-4xl">{"\u{1F389}"}</div>
              <p className="text-lg font-bold text-violet">
                You won {bettingResult.payout.toFixed(2)} SOL!
              </p>
              <p className="text-sm text-neutral-200">
                Your bet: {bettingResult.betAmount} SOL (5.7x payout)
              </p>
              {claimed ? (
                <p className="text-sm font-medium text-green-400">Winnings claimed!</p>
              ) : (
                <Button onClick={handleClaimWinnings} disabled={loading || !onClaimWinnings}>
                  {loading ? "Claiming..." : `Claim ${bettingResult.payout.toFixed(2)} SOL`}
                </Button>
              )}
              {error && <p className="text-center text-sm text-destructive">{error}</p>}
            </>
          ) : (
            <>
              <div className="text-4xl">{"\u{1F614}"}</div>
              <p className="text-lg font-medium text-neutral-200">Better luck next time</p>
              <p className="text-sm text-neutral-300">
                You bet {bettingResult.betAmount} SOL on {userBet?.agentName}
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (userBet) {
    return (
      <div className="rounded-2xl border border-neutral-50/10 bg-neutral-600 overflow-hidden">
        <div className="border-b border-neutral-50/10 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-50">Your Bet</h3>
        </div>
        <div className="flex flex-col items-center gap-3 p-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet/20 text-2xl">
            {"\u2705"}
          </div>
          <p className="text-center text-sm text-violet">
            You bet {userBet.amount} SOL on {userBet.agentName}
          </p>
          <div className="w-full rounded-xl bg-neutral-500/50 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-200">Potential Payout</span>
              <span className="font-medium text-gold">
                {(userBet.amount * PAYOUT_MULTIPLIER).toFixed(2)} SOL (5.7x)
              </span>
            </div>
          </div>
          <p className="text-xs text-neutral-300">Waiting for game to finish...</p>
        </div>
      </div>
    );
  }

  // Locked-betting pool summary
  if (bettingExpired && !userBet) {
    return (
      <div className="rounded-2xl border border-neutral-50/10 bg-neutral-600 overflow-hidden">
        <div className="border-b border-neutral-50/10 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-50">Betting Pool</h3>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-200">Total Pool</span>
            <span className="font-medium text-gold">{poolTotal.toLocaleString()} SOL</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {activePlayers.map((player) => {
              const pool = agentPools[player.publicKey] ?? 0;
              return (
                <div
                  key={player.publicKey}
                  className="flex items-center justify-between rounded-xl px-3 py-2 text-sm bg-neutral-500/50"
                >
                  <span className="flex items-center gap-2 text-neutral-50">
                    <img src={TEMPLATES[player.templateId]?.avatar ?? "/icon.png"} alt={player.displayName} className="size-5 rounded-full object-cover" />
                    {player.displayName}
                  </span>
                  <span className="text-neutral-200">{pool} SOL</span>
                </div>
              );
            })}
          </div>
          <p className="text-center text-xs text-neutral-300">
            Betting window closed. Watching game...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-50/10 bg-neutral-600 overflow-hidden">
      <div className="border-b border-neutral-50/10 px-4 py-3">
        <h3 className="text-sm font-semibold text-neutral-50">Place Your Bet</h3>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-200">Time Remaining</span>
            <span
              className={`font-medium ${countdown <= 5 ? "text-destructive" : "text-neutral-50"}`}
            >
              {countdown}s
            </span>
          </div>
          <Progress value={countdownProgress} className="h-1.5" />
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-neutral-200">Payout</span>
          <span className="font-medium text-gold">5.7x</span>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Select Agent</Label>
          <div className="flex flex-col gap-1.5">
            {activePlayers.map((player) => {
              const pool = agentPools[player.publicKey] ?? 0;
              return (
                <button
                  key={player.publicKey}
                  className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors cursor-pointer ${
                    selectedAgent === player.publicKey
                      ? "border border-violet/50 bg-violet/10"
                      : "bg-neutral-500/50 hover:bg-neutral-500"
                  } ${bettingExpired ? "pointer-events-none opacity-50" : ""}`}
                  onClick={() => setSelectedAgent(player.publicKey)}
                  disabled={bettingExpired}
                >
                  <span className="flex items-center gap-2 text-neutral-50">
                    <img src={TEMPLATES[player.templateId]?.avatar ?? "/icon.png"} alt={player.displayName} className="size-5 rounded-full object-cover" />
                    {player.displayName}
                  </span>
                  <span className="text-neutral-200">{pool} SOL</span>
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
          <div className="flex items-center justify-between rounded-xl bg-violet/10 px-3 py-2 text-sm">
            <span className="text-violet/80">Potential Payout</span>
            <span className="font-semibold text-violet">{potentialPayout.toFixed(2)} SOL</span>
          </div>
        )}

        {error && <p className="text-center text-sm text-destructive">{error}</p>}

        {bettingExpired ? (
          <p className="text-center text-sm text-destructive">Betting window closed</p>
        ) : !connected ? (
          <p className="text-center text-sm text-neutral-200">Connect wallet to place bets</p>
        ) : (
          <Button
            onClick={handlePlaceBet}
            disabled={!selectedAgent || !betAmount || bettingExpired || loading}
          >
            {loading ? "Placing Bet..." : "Place Bet"}
          </Button>
        )}
      </div>
    </div>
  );
}
