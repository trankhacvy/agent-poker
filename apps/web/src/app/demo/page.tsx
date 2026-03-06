"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LazyMotion, domAnimation } from "motion/react";
import type {
  GameStateSnapshot,
  GameAction,
  PlayerSnapshot,
  Street,
  ShowdownResult,
} from "@/lib/types";
import PokerTable from "@/components/poker/PokerTable";
import ActionFeed from "@/components/poker/ActionFeed";

// ── Helpers ──────────────────────────────────────────────────────────────────

let actionCounter = 0;
function nextActionId() {
  return `action-${++actionCounter}`;
}

/** Pick `count` unique random cards from 0-51 */
function dealCards(count: number, exclude: number[] = []): number[] {
  const pool = Array.from({ length: 52 }, (_, i) => i).filter(
    (c) => !exclude.includes(c)
  );
  const picked: number[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

// ── Mock player factory ─────────────────────────────────────────────────────

const AGENT_NAMES = ["SharkBot", "ManiacAI", "RockSolid", "FoxTrot", "DeepBluff", "NitKing"];
const TEMPLATE_IDS = [0, 1, 2, 3, 0, 1];

function createPlayers(count: number): PlayerSnapshot[] {
  const allCards = dealCards(count * 2);
  return Array.from({ length: count }, (_, i) => ({
    seatIndex: i,
    publicKey: `player-${i}-${Math.random().toString(36).slice(2, 10)}`,
    displayName: AGENT_NAMES[i] ?? `Agent${i}`,
    templateId: TEMPLATE_IDS[i] ?? i % 4,
    chips: 1000,
    currentBet: 0,
    cards: [allCards[i * 2], allCards[i * 2 + 1]],
    status: "active" as const,
    isDealer: i === 0,
  }));
}

// ── Street progression ──────────────────────────────────────────────────────

const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river", "showdown"];

function nextStreet(s: Street): Street {
  const idx = STREET_ORDER.indexOf(s);
  if (idx < STREET_ORDER.length - 1) return STREET_ORDER[idx + 1];
  return "showdown";
}

// ── Component ───────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [players, setPlayers] = useState<PlayerSnapshot[]>(() => createPlayers(6));
  const [street, setStreet] = useState<Street>("preflop");
  const [pot, setPot] = useState(0);
  const [communityCards, setCommunityCards] = useState<number[]>([]);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(1);
  const [actions, setActions] = useState<GameAction[]>([]);
  const [showdownResults, setShowdownResults] = useState<ShowdownResult[] | undefined>();
  const [winnerPubkey, setWinnerPubkey] = useState<string | undefined>();
  const [autoPlayRunning, setAutoPlayRunning] = useState(false);
  const autoPlayRef = useRef(false);

  // Cards already used by players
  const usedCards = useMemo(
    () => players.flatMap((p) => p.cards).filter((c) => c >= 0),
    [players]
  );

  const tableId = "demo-table-001";

  // Build game state snapshot
  const gameState: GameStateSnapshot = useMemo(
    () => ({
      tableId,
      street,
      pot,
      communityCards,
      players,
      currentPlayerIndex,
      dealerIndex: 0,
      smallBlind: 5,
      bigBlind: 10,
      minRaise: 20,
      isShowdown: street === "showdown",
      winnerIndex: winnerPubkey
        ? players.findIndex((p) => p.publicKey === winnerPubkey)
        : undefined,
    }),
    [tableId, street, pot, communityCards, players, currentPlayerIndex, winnerPubkey]
  );

  // Get active (non-folded) players
  const activePlayers = useMemo(
    () => players.filter((p) => p.status !== "folded"),
    [players]
  );

  const currentPlayer = players[currentPlayerIndex];

  // Advance to next active player
  const advancePlayer = useCallback(() => {
    setPlayers((prev) => {
      setCurrentPlayerIndex((ci) => {
        let next = (ci + 1) % prev.length;
        let tries = 0;
        while (prev[next].status === "folded" && tries < prev.length) {
          next = (next + 1) % prev.length;
          tries++;
        }
        return next;
      });
      return prev;
    });
  }, []);

  // Push an action
  const pushAction = useCallback(
    (playerIdx: number, actionType: GameAction["actionType"], amount: number) => {
      const p = players[playerIdx];
      if (!p) return;
      setActions((prev) => [
        ...prev,
        {
          id: nextActionId(),
          tableId,
          playerName: p.displayName,
          playerPublicKey: p.publicKey,
          actionType,
          amount,
          timestamp: Date.now(),
        },
      ]);
    },
    [players, tableId]
  );

  // ── Player actions ──────────────────────────────────────────────────────

  const doFold = useCallback(() => {
    const idx = currentPlayerIndex;
    pushAction(idx, "fold", 0);
    setPlayers((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, status: "folded" as const } : p))
    );
    advancePlayer();
  }, [currentPlayerIndex, pushAction, advancePlayer]);

  const doCheck = useCallback(() => {
    pushAction(currentPlayerIndex, "check", 0);
    advancePlayer();
  }, [currentPlayerIndex, pushAction, advancePlayer]);

  const doCall = useCallback(() => {
    const callAmount = 10;
    const idx = currentPlayerIndex;
    pushAction(idx, "call", callAmount);
    setPlayers((prev) =>
      prev.map((p, i) =>
        i === idx
          ? { ...p, chips: p.chips - callAmount, currentBet: p.currentBet + callAmount }
          : p
      )
    );
    setPot((p) => p + callAmount);
    advancePlayer();
  }, [currentPlayerIndex, pushAction, advancePlayer]);

  const doRaise = useCallback(
    (amount: number) => {
      const idx = currentPlayerIndex;
      pushAction(idx, "raise", amount);
      setPlayers((prev) =>
        prev.map((p, i) =>
          i === idx
            ? { ...p, chips: p.chips - amount, currentBet: p.currentBet + amount }
            : p
        )
      );
      setPot((p) => p + amount);
      advancePlayer();
    },
    [currentPlayerIndex, pushAction, advancePlayer]
  );

  const doAllIn = useCallback(() => {
    const idx = currentPlayerIndex;
    const p = players[idx];
    const amount = p.chips;
    pushAction(idx, "all-in", amount);
    setPlayers((prev) =>
      prev.map((pl, i) =>
        i === idx
          ? { ...pl, chips: 0, currentBet: pl.currentBet + amount, status: "all-in" as const }
          : pl
      )
    );
    setPot((pot) => pot + amount);
    advancePlayer();
  }, [currentPlayerIndex, players, pushAction, advancePlayer]);

  // ── Street progression ────────────────────────────────────────────────

  const advanceStreet = useCallback(() => {
    if (street === "showdown") return;
    const next = nextStreet(street);

    // Reset current bets
    setPlayers((prev) => prev.map((p) => ({ ...p, currentBet: 0 })));

    if (next === "flop") {
      const newCards = dealCards(3, [...usedCards, ...communityCards]);
      setCommunityCards(newCards);
    } else if (next === "turn") {
      const newCard = dealCards(1, [...usedCards, ...communityCards]);
      setCommunityCards((prev) => [...prev, ...newCard]);
    } else if (next === "river") {
      const newCard = dealCards(1, [...usedCards, ...communityCards]);
      setCommunityCards((prev) => [...prev, ...newCard]);
    } else if (next === "showdown") {
      // Pick a random winner from active players
      const active = players.filter((p) => p.status !== "folded");
      const winner = active[Math.floor(Math.random() * active.length)];
      const handNames = [
        "Royal Flush",
        "Straight Flush",
        "Four of a Kind",
        "Full House",
        "Flush",
        "Straight",
        "Three of a Kind",
        "Two Pair",
        "One Pair",
        "High Card",
      ];

      const results: ShowdownResult[] = active.map((p) => ({
        publicKey: p.publicKey,
        displayName: p.displayName,
        cards: p.cards,
        handName:
          p.publicKey === winner.publicKey
            ? handNames[Math.floor(Math.random() * 4)] // top hand for winner
            : handNames[4 + Math.floor(Math.random() * 6)], // weaker for losers
        isWinner: p.publicKey === winner.publicKey,
      }));

      setShowdownResults(results);
      setWinnerPubkey(winner.publicKey);
    }

    setStreet(next);
    // Set current player to first non-folded
    setCurrentPlayerIndex((ci) => {
      let idx = 0;
      while (players[idx]?.status === "folded" && idx < players.length) idx++;
      return idx;
    });
  }, [street, usedCards, communityCards, players]);

  // ── Reset / New game ──────────────────────────────────────────────────

  const resetGame = useCallback(() => {
    actionCounter = 0;
    const newPlayers = createPlayers(6);
    setPlayers(newPlayers);
    setStreet("preflop");
    setPot(0);
    setCommunityCards([]);
    setCurrentPlayerIndex(1);
    setActions([]);
    setShowdownResults(undefined);
    setWinnerPubkey(undefined);
  }, []);

  // ── Auto-play ─────────────────────────────────────────────────────────

  const doRandomAction = useCallback(() => {
    const p = players[currentPlayerIndex];
    if (!p || p.status === "folded") {
      advancePlayer();
      return;
    }

    const roll = Math.random();
    if (roll < 0.15) {
      doFold();
    } else if (roll < 0.4) {
      doCheck();
    } else if (roll < 0.7) {
      doCall();
    } else if (roll < 0.92) {
      doRaise(20 + Math.floor(Math.random() * 50));
    } else {
      doAllIn();
    }
  }, [players, currentPlayerIndex, advancePlayer, doFold, doCheck, doCall, doRaise, doAllIn]);

  useEffect(() => {
    autoPlayRef.current = autoPlayRunning;
  }, [autoPlayRunning]);

  useEffect(() => {
    if (!autoPlayRunning) return;
    if (street === "showdown") {
      setAutoPlayRunning(false);
      return;
    }

    const timer = setInterval(() => {
      if (!autoPlayRef.current) return;
      doRandomAction();
    }, 1200);

    return () => clearInterval(timer);
  }, [autoPlayRunning, doRandomAction, street]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (street === "showdown") return;
      switch (e.key.toLowerCase()) {
        case "f":
          doFold();
          break;
        case "c":
          doCheck();
          break;
        case "l":
          doCall();
          break;
        case "r":
          doRaise(30);
          break;
        case "a":
          doAllIn();
          break;
        case "n":
          advanceStreet();
          break;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [doFold, doCheck, doCall, doRaise, doAllIn, advanceStreet, street]);

  const isShowdown = street === "showdown";

  return (
    <LazyMotion features={domAnimation}>
      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">UI Demo Table</h1>
            <p className="text-sm text-muted-foreground">
              Simulated poker with 6 players. Use buttons or keyboard shortcuts.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoPlayRunning(!autoPlayRunning)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                autoPlayRunning
                  ? "bg-red-500 text-white hover:bg-red-600"
                  : "bg-emerald-500 text-white hover:bg-emerald-600"
              }`}
            >
              {autoPlayRunning ? "Stop Auto" : "Auto Play"}
            </button>
            <button
              onClick={resetGame}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-neutral-500 text-neutral-50 hover:bg-neutral-400 transition-colors"
            >
              New Game
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Left: Table + controls */}
          <div className="flex flex-col gap-4">
            <PokerTable
              gameState={gameState}
              showdownResults={showdownResults}
              winnerPublicKey={winnerPubkey}
              actions={actions}
            />

            {/* Controls */}
            <div className="bg-neutral-600 rounded-xl border border-neutral-50/10 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-300">Current Turn:</span>
                  <span className="text-sm font-bold text-neutral-50">
                    {currentPlayer?.displayName ?? "—"}
                  </span>
                  <span className="text-xs text-neutral-300">
                    ({currentPlayer?.chips ?? 0} chips)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-neutral-300 uppercase tracking-wider">
                    {street}
                  </span>
                  <span className="text-[10px] text-gold">
                    Pot: {pot}
                  </span>
                </div>
              </div>

              {!isShowdown ? (
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    label="Fold"
                    shortcut="F"
                    onClick={doFold}
                    className="bg-gray-600 hover:bg-gray-500"
                  />
                  <ActionButton
                    label="Check"
                    shortcut="C"
                    onClick={doCheck}
                    className="bg-blue-600 hover:bg-blue-500"
                  />
                  <ActionButton
                    label="Call 10"
                    shortcut="L"
                    onClick={doCall}
                    className="bg-green-600 hover:bg-green-500"
                  />
                  <ActionButton
                    label="Raise 30"
                    shortcut="R"
                    onClick={() => doRaise(30)}
                    className="bg-amber-600 hover:bg-amber-500"
                  />
                  <ActionButton
                    label="Raise 100"
                    shortcut=""
                    onClick={() => doRaise(100)}
                    className="bg-amber-700 hover:bg-amber-600"
                  />
                  <ActionButton
                    label="All In"
                    shortcut="A"
                    onClick={doAllIn}
                    className="bg-red-600 hover:bg-red-500"
                  />
                  <div className="w-px bg-neutral-50/10 mx-1" />
                  <ActionButton
                    label={`Next Street (${nextStreet(street)})`}
                    shortcut="N"
                    onClick={advanceStreet}
                    className="bg-violet-600 hover:bg-violet-500"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gold font-bold">
                    Winner: {players.find((p) => p.publicKey === winnerPubkey)?.displayName}
                  </span>
                  <button
                    onClick={resetGame}
                    className="px-4 py-2 rounded-lg text-sm font-bold bg-gold text-neutral-700 hover:bg-gold/80 transition-colors"
                  >
                    Deal New Hand
                  </button>
                </div>
              )}
            </div>

            {/* Action Feed */}
            <ActionFeed actions={actions} />
          </div>

          {/* Right: Player states debug panel */}
          <div className="flex flex-col gap-3">
            <div className="bg-neutral-600 rounded-xl border border-neutral-50/10 p-4">
              <h3 className="text-xs font-bold text-neutral-300 uppercase tracking-wider mb-3">
                Player States
              </h3>
              <div className="space-y-2">
                {players.map((p, i) => (
                  <div
                    key={p.publicKey}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                      i === currentPlayerIndex
                        ? "bg-neutral-50/10 border border-neutral-50/20"
                        : "bg-neutral-50/[0.03]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          p.status === "active"
                            ? "bg-emerald-400"
                            : p.status === "folded"
                              ? "bg-zinc-500"
                              : "bg-red-400"
                        }`}
                      />
                      <span className="font-medium text-neutral-100">{p.displayName}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-neutral-300">{p.chips}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          p.status === "active"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : p.status === "folded"
                              ? "bg-zinc-500/20 text-zinc-400"
                              : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {p.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Keyboard shortcuts reference */}
            <div className="bg-neutral-600 rounded-xl border border-neutral-50/10 p-4">
              <h3 className="text-xs font-bold text-neutral-300 uppercase tracking-wider mb-3">
                Keyboard Shortcuts
              </h3>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                {[
                  ["F", "Fold"],
                  ["C", "Check"],
                  ["L", "Call"],
                  ["R", "Raise 30"],
                  ["A", "All In"],
                  ["N", "Next Street"],
                ].map(([key, label]) => (
                  <div key={key} className="flex items-center gap-2">
                    <kbd className="px-1.5 py-0.5 bg-neutral-50/10 rounded text-neutral-200 font-mono text-[10px]">
                      {key}
                    </kbd>
                    <span className="text-neutral-300">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick scenarios */}
            <div className="bg-neutral-600 rounded-xl border border-neutral-50/10 p-4">
              <h3 className="text-xs font-bold text-neutral-300 uppercase tracking-wider mb-3">
                Quick Scenarios
              </h3>
              <div className="flex flex-col gap-2">
                <ScenarioButton
                  label="Skip to Flop"
                  onClick={() => {
                    setStreet("preflop");
                    setPot(30);
                    advanceStreet();
                  }}
                />
                <ScenarioButton
                  label="Skip to River"
                  onClick={() => {
                    const allUsed = players.flatMap((p) => p.cards);
                    const cc = dealCards(5, allUsed);
                    setCommunityCards(cc);
                    setStreet("river");
                    setPot(200);
                    setPlayers((prev) => prev.map((p) => ({ ...p, currentBet: 0 })));
                  }}
                />
                <ScenarioButton
                  label="Trigger Showdown"
                  onClick={() => {
                    const allUsed = players.flatMap((p) => p.cards);
                    if (communityCards.length < 5) {
                      const cc = dealCards(5, allUsed);
                      setCommunityCards(cc);
                    }
                    setPot(500);
                    // Simulate showdown
                    const active = players.filter((p) => p.status !== "folded");
                    const winner = active[Math.floor(Math.random() * active.length)];
                    const handNames = [
                      "Royal Flush", "Straight Flush", "Four of a Kind",
                      "Full House", "Flush", "Straight",
                      "Three of a Kind", "Two Pair", "One Pair", "High Card",
                    ];
                    setShowdownResults(
                      active.map((p) => ({
                        publicKey: p.publicKey,
                        displayName: p.displayName,
                        cards: p.cards,
                        handName:
                          p.publicKey === winner.publicKey
                            ? handNames[Math.floor(Math.random() * 3)]
                            : handNames[4 + Math.floor(Math.random() * 6)],
                        isWinner: p.publicKey === winner.publicKey,
                      }))
                    );
                    setWinnerPubkey(winner.publicKey);
                    setStreet("showdown");
                  }}
                />
                <ScenarioButton
                  label="Fold All But Two"
                  onClick={() => {
                    setPlayers((prev) =>
                      prev.map((p, i) =>
                        i >= 2 ? { ...p, status: "folded" as const } : p
                      )
                    );
                    setCurrentPlayerIndex(0);
                  }}
                />
                <ScenarioButton
                  label="Two Players All-In"
                  onClick={() => {
                    setPlayers((prev) =>
                      prev.map((p, i) => {
                        if (i === 0) return { ...p, status: "all-in" as const, chips: 0, currentBet: 500 };
                        if (i === 1) return { ...p, status: "all-in" as const, chips: 0, currentBet: 500 };
                        return { ...p, status: "folded" as const };
                      })
                    );
                    setPot(1000);
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </LazyMotion>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ActionButton({
  label,
  shortcut,
  onClick,
  className = "",
}: {
  label: string;
  shortcut: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-colors flex items-center gap-1.5 ${className}`}
    >
      {label}
      {shortcut && (
        <kbd className="px-1 py-0.5 bg-black/30 rounded text-[9px] font-mono">{shortcut}</kbd>
      )}
    </button>
  );
}

function ScenarioButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-neutral-200 bg-neutral-50/[0.04] hover:bg-neutral-50/[0.08] hover:text-neutral-100 transition-colors"
    >
      {label}
    </button>
  );
}
