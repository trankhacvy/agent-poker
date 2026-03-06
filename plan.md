# Plan: Chain-First Architecture — Frontend Reads Directly from Solana

## Problem

The backend holds critical game state in memory and relays it to the frontend via WebSocket. This means:

1. **Page refresh** = blank poker table (frontend waits for next WS message, `gameState` is `null`)
2. **Server restart** = total state loss (virtual balances, round number, active game, bet tracking)
3. **State duplication** = the backend maintains a parallel copy of on-chain data that can drift

The root cause: the frontend treats the backend as its data source, when the data actually lives on Solana.

## Solution: Frontend Subscribes Directly to On-Chain Accounts

We already have:
- Codama-generated decoders in `packages/program-clients` (`decodeGameState`, `decodeBettingPool`, `decodeAgentAccount`, `decodePlayerHand`)
- The `accountNotifications` subscription pattern (user's previous project)
- RPC/WS endpoints for both L1 (`api.devnet.solana.com`) and ER (`devnet.magicblock.app`)

### New Architecture

```
                    SOLANA L1                    MAGICBLOCK ER
              ┌─────────────────┐          ┌─────────────────┐
              │ BettingPool     │          │ GameState       │
              │ AgentAccount x6 │          │ PlayerHand x6   │
              └────────┬────────┘          └────────┬────────┘
                       │                            │
                 accountNotifications          accountNotifications
                       │                            │
              ┌────────┴────────────────────────────┴────────┐
              │              FRONTEND (Next.js)               │
              │                                               │
              │  useGameStateSubscription  → GameState from ER│
              │  usePlayerHandSubscription → Hole cards       │
              │  useBettingPoolSubscription→ Pool from L1     │
              │  useArenaAgentStats        → Stats from L1    │
              │                                               │
              │  useArenaLifecycle (WS)    → Timers, LLM      │
              └────────┬──────────────────────────────────────┘
                       │ lightweight WebSocket
              ┌────────┴──────────────────────────────────────┐
              │              GAME SERVER (Fastify)             │
              │                                               │
              │  Orchestrator: submit txs, call LLMs          │
              │  ArenaManager: timers, lifecycle coordination  │
              │  WebSocket: lifecycle events + LLM reasoning   │
              │                                               │
              │  Does NOT hold: game state, pool state,        │
              │  virtual balances, action history              │
              └───────────────────────────────────────────────┘
```

### What the Frontend Reads from Chain (no server needed)

| Data | Source | Account | Decoder |
|------|--------|---------|---------|
| Game phase, pot, bets, community cards, current player, winner | ER | `GameState` PDA | `decodeGameState` |
| Hole cards per player | ER | `PlayerHand` PDA x6 | `decodePlayerHand` |
| Betting pool total, status | L1 | `BettingPool` PDA | `decodeBettingPool` |
| Agent stats (wins, games, earnings) | L1 | `AgentAccount` PDA x6 | `decodeAgentAccount` |

### What the Backend Still Provides via WebSocket

| Data | Why |
|------|-----|
| Arena lifecycle (round start, betting window open/close, cooldown) | Server-managed timers, not on-chain |
| Game IDs and table IDs for new rounds | Frontend needs to know which PDAs to subscribe to |
| LLM reasoning per action | Off-chain only — the "why" behind each fold/raise/call |
| Agent display names, templates, personalities | Static config, sent once per round |

### What Gets Deleted from Backend

| Current State | Why It's Removed |
|---------------|------------------|
| `orchestrator.activeGames` Map (orchestrator.ts:26) | Frontend reads GameState from ER directly |
| `orchestrator.syncLocalState()` (orchestrator.ts:286-304) | No local state to sync |
| `orchestrator.applyAction()` (orchestrator.ts:312-349) | No local state to apply to |
| `orchestrator.broadcastState()` game_state/game_action (orchestrator.ts:352-366) | Frontend gets state from chain subscription |
| `arenaManager.currentPool` off-chain bet tracking (arena-manager.ts:54-57) | Frontend reads BettingPool from L1 |
| `arenaManager.virtualBalances` Map (arena-manager.ts:60) | Frontend derives from AgentAccount stats |
| `arenaManager.placeBet()` off-chain mirroring (arena-manager.ts:111-154) | Frontend reads pool from chain |
| `arenaManager.getPool()` (arena-manager.ts:92-99) | Frontend reads pool from chain |
| Most of `adapters.ts` on frontend | No longer converting backend game state format |
| `POST /api/arena/bet` server notification (routes/arena.ts:32-51) | Pool updates come from chain subscription |
| `GET /api/arena/pool` (routes/arena.ts:15-17) | Frontend reads pool from chain |

---

## Phase 1: Frontend On-Chain Subscription Infrastructure

### 1.1 New environment variables

**File**: `apps/web/.env.local` (and Next.js config)

```env
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_WS_URL=wss://api.devnet.solana.com
NEXT_PUBLIC_ER_RPC_URL=https://devnet.magicblock.app/
NEXT_PUBLIC_ER_WS_URL=wss://devnet.magicblock.app/
```

**File**: `apps/web/src/lib/constants.ts`

Add:

```typescript
export const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const SOLANA_WS_URL = process.env.NEXT_PUBLIC_SOLANA_WS_URL ?? "wss://api.devnet.solana.com";
export const ER_RPC_URL = process.env.NEXT_PUBLIC_ER_RPC_URL ?? "https://devnet.magicblock.app/";
export const ER_WS_URL = process.env.NEXT_PUBLIC_ER_WS_URL ?? "wss://devnet.magicblock.app/";
```

### 1.2 Generic account subscription hook

**New file**: `apps/web/src/hooks/useAccountSubscription.ts`

Core reusable hook using the user's existing `accountNotifications` pattern from their previous project, adapted for React:

```typescript
import { useEffect, useRef, useState } from "react";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getBase64Encoder,
  type Address,
  type MaybeAccount,
  type MaybeEncodedAccount,
} from "@solana/kit";

interface UseAccountSubscriptionOptions<T> {
  rpcUrl: string;
  wsUrl: string;
  address: Address | null;
  decode: (encoded: MaybeEncodedAccount<string>) => MaybeAccount<T, string>;
  enabled?: boolean;
}

interface UseAccountSubscriptionReturn<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function useAccountSubscription<T>({
  rpcUrl,
  wsUrl,
  address,
  decode,
  enabled = true,
}: UseAccountSubscriptionOptions<T>): UseAccountSubscriptionReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!address || !enabled) {
      setData(null);
      return;
    }

    setLoading(true);
    let cancelled = false;
    const abortController = new AbortController();

    const rpc = createSolanaRpc(rpcUrl);
    const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);

    // 1. Initial fetch
    fetchEncodedAccount(rpc, address)
      .then((encoded) => {
        if (cancelled) return;
        const decoded = decode(encoded);
        if (decoded.exists) {
          setData(decoded.data);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });

    // 2. Subscribe to changes
    rpcSubscriptions
      .accountNotifications(address, {
        commitment: "confirmed",
        encoding: "base64",
      })
      .subscribe({ abortSignal: abortController.signal })
      .then(async (notifications) => {
        for await (const notification of notifications) {
          if (cancelled) break;
          const encodedData = getBase64Encoder().encode(notification.value.data[0]);
          const encoded: MaybeEncodedAccount<string> = {
            address,
            exists: true,
            executable: notification.value.executable,
            lamports: notification.value.lamports,
            programAddress: notification.value.owner,
            space: notification.value.space,
            data: encodedData,
          };
          const decoded = decode(encoded);
          if (decoded.exists) {
            setData(decoded.data);
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });

    cleanupRef.current = () => {
      cancelled = true;
      abortController.abort();
    };

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [rpcUrl, wsUrl, address, enabled]);

  return { data, loading, error };
}
```

### 1.3 PDA derivation utilities

**New file**: `apps/web/src/lib/pda.ts`

Frontend PDA derivation matching the backend's `solana-write.ts:54-69`:

```typescript
import { getProgramDerivedAddress, getU64Encoder, type Address, address } from "@solana/kit";
import { GAME_PROGRAM_ID, BETTING_PROGRAM_ID } from "./constants";

const GAME_SEED = new TextEncoder().encode("poker_game");
const HAND_SEED = new TextEncoder().encode("player_hand");
const POOL_SEED = new TextEncoder().encode("bet_pool");
const AGENT_SEED = new TextEncoder().encode("agent");

// Matches server's toBn() logic (solana-write.ts:89-93)
function idToU64(value: string): bigint {
  if (/^\d+$/.test(value)) return BigInt(value);
  return BigInt("0x" + value.replace(/-/g, "").slice(0, 16));
}

export async function deriveGamePda(gameId: string): Promise<Address> {
  const idBytes = getU64Encoder().encode(idToU64(gameId));
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(GAME_PROGRAM_ID),
    seeds: [GAME_SEED, idBytes],
  });
  return pda;
}

export async function derivePlayerHandPda(gameId: string, seatIndex: number): Promise<Address> {
  const idBytes = getU64Encoder().encode(idToU64(gameId));
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(GAME_PROGRAM_ID),
    seeds: [HAND_SEED, idBytes, new Uint8Array([seatIndex])],
  });
  return pda;
}

export async function derivePoolPda(tableId: string): Promise<Address> {
  const idBytes = getU64Encoder().encode(idToU64(tableId));
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(BETTING_PROGRAM_ID),
    seeds: [POOL_SEED, idBytes],
  });
  return pda;
}

export async function deriveAgentPda(ownerPubkey: string): Promise<Address> {
  // Uses the owner pubkey bytes as seed, matching solana-write.ts:522-527
  const ownerBytes = /* decode base58 ownerPubkey to 32 bytes */;
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(AGENT_PROGRAM_ID),
    seeds: [AGENT_SEED, ownerBytes],
  });
  return pda;
}
```

Note: `derivePoolPda` already exists in `useBettingProgram.ts:31-38`. Extract and reuse.

---

## Phase 2: Frontend Reads GameState + PlayerHands from ER

### 2.1 useGameStateSubscription hook

**New file**: `apps/web/src/hooks/useGameStateSubscription.ts`

```typescript
import { useMemo } from "react";
import { useAccountSubscription } from "./useAccountSubscription";
import { decodeGameState, type GameState } from "@repo/program-clients/game";
import { ER_RPC_URL, ER_WS_URL } from "@/lib/constants";
import type { Address } from "@solana/kit";

export function useGameStateSubscription(gamePda: Address | null) {
  return useAccountSubscription<GameState>({
    rpcUrl: ER_RPC_URL,
    wsUrl: ER_WS_URL,
    address: gamePda,
    decode: decodeGameState,
    enabled: !!gamePda,
  });
}
```

### 2.2 usePlayerHandsSubscription hook

**New file**: `apps/web/src/hooks/usePlayerHandsSubscription.ts`

Subscribes to all 6 PlayerHand PDAs on ER simultaneously:

```typescript
import { useState, useEffect } from "react";
import { decodePlayerHand, type PlayerHand } from "@repo/program-clients/game";
import { derivePlayerHandPda } from "@/lib/pda";
import { ER_RPC_URL, ER_WS_URL } from "@/lib/constants";
import type { Address } from "@solana/kit";

export function usePlayerHandsSubscription(
  gameId: string | null,
  playerCount: number
): Map<number, [number, number]> {
  // For each seat 0..playerCount-1:
  //   1. Derive PlayerHand PDA
  //   2. Subscribe to account on ER
  //   3. Decode hand bytes [u8; 2] into card codes
  // Return Map<seatIndex, [card0, card1]>
  //
  // Each subscription uses useAccountSubscription internally.
  // When gameId changes (new round), old subscriptions clean up automatically.
}
```

The PlayerHand account structure (from playerHand.ts:50-56):
```
{ discriminator, gameId: bigint, player: Address, hand: Uint8Array(2), bump: number }
```

`hand` is a 2-byte array of card codes — same encoding used throughout the system.

### 2.3 Map on-chain GameState to frontend types

**New file**: `apps/web/src/lib/chain-adapters.ts`

Replace most of `adapters.ts` with direct on-chain-to-UI mapping:

```typescript
import { type GameState, GamePhase } from "@repo/program-clients/game";
import type { GameStateSnapshot, PlayerSnapshot, Street } from "./types";
import { TEMPLATES } from "./constants";

const LAMPORTS_PER_SOL = 1_000_000_000;

const PHASE_TO_STREET: Record<GamePhase, Street> = {
  [GamePhase.Waiting]: "preflop",
  [GamePhase.Preflop]: "preflop",
  [GamePhase.Flop]: "flop",
  [GamePhase.Turn]: "turn",
  [GamePhase.River]: "river",
  [GamePhase.Showdown]: "showdown",
  [GamePhase.Complete]: "showdown",
};

const STATUS_MAP: Record<number, PlayerSnapshot["status"]> = {
  0: "sitting-out",  // empty
  1: "active",
  2: "folded",
  3: "all-in",
};

export function mapGameStateToSnapshot(
  gs: GameState,
  holeCards: Map<number, [number, number]>,
  agentNames: Map<string, { displayName: string; template: number }>
): GameStateSnapshot {
  const players: PlayerSnapshot[] = [];
  for (let i = 0; i < gs.playerCount; i++) {
    const pubkey = gs.players[i];
    const agent = agentNames.get(pubkey);
    players.push({
      seatIndex: i,
      publicKey: pubkey,
      displayName: agent?.displayName ?? `Player ${i}`,
      templateId: agent?.template ?? 0,
      chips: Number(gs.wagerTier) / LAMPORTS_PER_SOL,
      currentBet: Number(gs.playerBets[i]) / LAMPORTS_PER_SOL,
      cards: holeCards.get(i) ? [...holeCards.get(i)!] : [-1, -1],
      status: STATUS_MAP[gs.playerStatus[i]] ?? "active",
      isDealer: i === gs.dealerIndex,
    });
  }

  const communityCards = Array.from(gs.communityCards).slice(0, gs.communityCount);
  const bbAmount = Number(gs.wagerTier) * 100 / 1000;
  const sbAmount = bbAmount / 2;

  return {
    tableId: gs.tableId.toString(),
    street: PHASE_TO_STREET[gs.phase] ?? "preflop",
    pot: Number(gs.pot) / LAMPORTS_PER_SOL,
    communityCards: Array.from(communityCards),
    players,
    currentPlayerIndex: gs.currentPlayer,
    dealerIndex: gs.dealerIndex,
    smallBlind: sbAmount / LAMPORTS_PER_SOL,
    bigBlind: bbAmount / LAMPORTS_PER_SOL,
    minRaise: (bbAmount * 2) / LAMPORTS_PER_SOL,
    isShowdown: gs.phase === GamePhase.Showdown || gs.phase === GamePhase.Complete,
    winnerIndex: gs.winnerIndex,
  };
}
```

This replaces `adaptGameState()` in `adapters.ts` which currently converts from the server's format. Now we convert directly from the on-chain account structure.

### 2.4 Agent name/template mapping for arena

The on-chain `GameState.players` array contains pubkeys. The frontend needs to map these to display names and templates. For arena mode, this is static — the 6 arena agents are hardcoded.

**File**: `apps/web/src/lib/constants.ts` (already has `TEMPLATES`)

Add a pubkey->agent mapping. The arena agent pubkeys are deterministic (SHA-256 of seed strings). We need them available on the frontend. Currently `ARENA_AGENTS` with pubkeys only exists on the backend (`arena-agents.ts`).

Options:
1. **Hardcode the 6 arena agent pubkeys in frontend constants** — simplest, they never change
2. **Fetch from `/api/arena/agents` once on page load** — current approach, keep it
3. **Derive from the same SHA-256 seeds** — requires crypto in the browser

Option 2 is cleanest: the server sends `agents` array in `arena_betting_open` and in `/api/arena/status`. The frontend already stores these in `agents` state. Use `agents` to build the name mapping for `mapGameStateToSnapshot`.

---

## Phase 3: Frontend Reads BettingPool from L1

### 3.1 useBettingPoolSubscription hook

**New file**: `apps/web/src/hooks/useBettingPoolSubscription.ts`

```typescript
import { useAccountSubscription } from "./useAccountSubscription";
import { decodeBettingPool, type BettingPool } from "@repo/program-clients/betting";
import { SOLANA_RPC_URL, SOLANA_WS_URL } from "@/lib/constants";
import type { Address } from "@solana/kit";

export function useBettingPoolSubscription(poolPda: Address | null) {
  return useAccountSubscription<BettingPool>({
    rpcUrl: SOLANA_RPC_URL,
    wsUrl: SOLANA_WS_URL,
    address: poolPda,
    decode: decodeBettingPool,
    enabled: !!poolPda,
  });
}
```

The `BettingPool` account (from bettingPool.ts:66-77) has:
- `totalPool: bigint` — total SOL in the pool
- `betCount: number` — number of bets placed
- `status: PoolStatus` — Open / Locked / Settled
- `winnerIndex: Option<number>` — set after settlement
- `agents: Address[6]` — the 6 agent pubkeys

Note: `BettingPool` has `totalPool` but NOT per-agent breakdown. Per-agent totals require reading individual `BetAccount` PDAs. Two options:

**Option A**: Server still broadcasts per-agent breakdown via WS (keep `arena_pool_update` message). This is the simplest — the server already tracks this.

**Option B**: Frontend does a GPA (getProgramAccounts) query filtered by pool PDA to find all BetAccounts for the pool. More complex but fully chain-first.

**Recommendation**: Option A for now. The `arena_pool_update` message is lightweight and the per-agent breakdown is useful UX. The chain subscription gives us `totalPool` and `status` (for knowing when the pool is locked/settled), and the server supplements with breakdown.

### 3.2 Remove off-chain pool mirroring from backend

**File**: `apps/game-server/src/plugins/arena-manager.ts`

Remove:
- `currentPool` property (line 54-57)
- `placeBet()` method (line 111-154) — the frontend sends `place_bet` tx directly on-chain. The backend no longer needs to mirror bets.
- `getPool()` method (line 92-99)

Keep:
- `arena_pool_update` WS message — but now derived from on-chain reads instead of off-chain tracking. After each on-chain `place_bet` tx is confirmed, broadcast the updated pool breakdown.

Actually, simpler: since the frontend subscribes to BettingPool on-chain, it gets `totalPool` updates automatically. The per-agent breakdown can come from the server (which monitors the pool) or we accept showing only the total.

### 3.3 Simplify arena bet flow

Current flow:
1. Frontend builds `place_bet` tx → wallet signs → on-chain
2. Frontend calls `POST /api/arena/bet` with txSignature → server verifies → mirrors off-chain → broadcasts pool_update

New flow:
1. Frontend builds `place_bet` tx → wallet signs → on-chain
2. Frontend's `useBettingPoolSubscription` automatically sees `totalPool` change
3. Done. No server notification needed.

Remove `POST /api/arena/bet` endpoint and `placeArenaBet()` API function.

---

## Phase 4: Derive Virtual Balances from On-Chain Agent Stats

### 4.1 Backend: Update AgentAccount stats after each arena round

**File**: `apps/game-server/src/plugins/arena-manager.ts`

Currently arena mode never calls `updateAgentStats`. Add after game result (line 317):

```typescript
if (gameResult) {
  const { winnerIndex, pot } = gameResult;

  // Update on-chain agent stats for ALL 6 players
  for (let i = 0; i < ARENA_AGENTS.length; i++) {
    const agent = ARENA_AGENTS[i];
    const isWinner = i === winnerIndex;
    try {
      await this.solanaClient.updateAgentStats(
        agent.pubkey,
        1,                          // gamesDelta
        isWinner ? 1 : 0,           // winsDelta
        isWinner ? Math.floor(pot * 0.95) : 0  // earningsDelta
      );
    } catch (err) {
      this.log.warn({ err, agent: agent.displayName }, "Failed to update agent stats");
    }
  }
  // ... rest of settlement
}
```

### 4.2 Backend: Ensure arena AgentAccounts exist on-chain

**File**: `apps/game-server/src/plugins/arena-manager.ts` → `start()` method

Before the game loop, create AgentAccount PDAs for all 6 arena agents if they don't exist:

```typescript
async start(): Promise<void> {
  await this.ensureArenaAgentsExist();
  this.running = true;
  this.loop().catch(...);
}

private async ensureArenaAgentsExist(): Promise<void> {
  for (const agent of ARENA_AGENTS) {
    try {
      const existing = await this.solanaRead.getAgent(/* agentPda derived from agent.pubkey */);
      if (!existing) {
        // create_agent ix requires the owner to sign.
        // Arena agent keypairs are deterministic (SHA-256 of seed strings).
        // The server has access to these keypairs via arena-agents.ts AGENT_KEYPAIRS.
        await this.solanaClient.createArenaAgent(agent.pubkey, agent.template, agent.displayName);
        this.log.info({ agent: agent.displayName }, "Created arena agent on-chain");
      }
    } catch (err) {
      this.log.debug({ err, agent: agent.displayName }, "Arena agent check (may already exist)");
    }
  }
}
```

**File**: `apps/game-server/src/plugins/solana-write.ts`

Add `createArenaAgent()` method. The `create_agent` instruction requires the `owner` to sign. Arena agent keypairs are available from `arena-agents.ts` (`AGENT_KEYPAIRS` derived from SHA-256 seeds). Export the keypairs from arena-agents.ts so solana-write can use them.

**File**: `apps/game-server/src/lib/arena-agents.ts`

Export `AGENT_KEYPAIRS`:

```typescript
export const AGENT_KEYPAIRS = AGENT_SEEDS.map(deriveKeypair);  // already exists at line 28, just export
```

### 4.3 Frontend: Derive virtual balances from AgentAccount stats

**New file**: `apps/web/src/hooks/useArenaAgentStats.ts`

```typescript
import { useEffect, useState } from "react";
import { createSolanaRpc, address } from "@solana/kit";
import { fetchMaybeAgentAccount } from "@repo/program-clients/agent";
import { SOLANA_RPC_URL } from "@/lib/constants";
import { deriveAgentPda } from "@/lib/pda";
import type { ArenaAgentConfig } from "@/lib/arena-types";

function deriveVirtualBalance(totalGames: number, totalWins: number): number {
  const losses = totalGames - totalWins;
  return Math.max(50, 100 + (totalWins * 10) - (losses * 2));
}

export function useArenaAgentStats(agents: ArenaAgentConfig[]) {
  const [agentsWithBalances, setAgentsWithBalances] = useState(agents);

  useEffect(() => {
    if (agents.length === 0) return;

    const rpc = createSolanaRpc(SOLANA_RPC_URL);

    async function fetchStats() {
      const updated = await Promise.all(
        agents.map(async (agent) => {
          try {
            const agentPda = await deriveAgentPda(agent.pubkey);
            const account = await fetchMaybeAgentAccount(rpc, agentPda);
            if (account.exists) {
              return {
                ...agent,
                virtualBalance: deriveVirtualBalance(
                  Number(account.data.totalGames),
                  Number(account.data.totalWins)
                ),
              };
            }
          } catch { /* use default */ }
          return { ...agent, virtualBalance: agent.virtualBalance ?? 100 };
        })
      );
      setAgentsWithBalances(updated);
    }

    fetchStats();
    // Refresh after each round (triggered by agents array changing from WS)
  }, [agents]);

  return agentsWithBalances;
}
```

### 4.4 Backend: Remove virtual balance tracking

**File**: `apps/game-server/src/plugins/arena-manager.ts`

Remove:
- `virtualBalances` Map (line 60)
- `updateVirtualBalances()` method (line 431-442)
- Virtual balance initialization in constructor (line 70-72)
- Virtual balance from `getStatus()` response — instead, `agents` array just includes the static config. Frontend derives balances from chain.

The `arena_game_complete` WS message no longer includes `virtualBalances`. Frontend computes them locally from AgentAccount stats.

---

## Phase 5: Slim Down Backend

### 5.1 Simplify Orchestrator — remove state duplication

**File**: `apps/game-server/src/plugins/orchestrator.ts`

Remove:
- `activeGames: Map<string, GameStateSnapshot>` (line 26) — frontend reads from chain
- `syncLocalState()` (line 286-304)
- `applyAction()` (line 312-349)
- `broadcastState()` for `game_state`, `game_action`, `game_start` (line 352-366)
- `getGameState()` getter (line 282-284) — no longer needed
- `countActivePlayers()` using local state (line 306-310) — read from ER directly

The orchestrator still:
- Runs the game loop (create → join → delegate → VRF → action loop → showdown → commit)
- Calls LLM for decisions
- Reads GameState from ER to determine whose turn it is and what actions are valid
- Submits `player_action` transactions to ER

New: After each LLM decision, broadcast **only the LLM enrichment** (not the full game state):

```typescript
// New message type: arena_agent_action
this.wsFeed.broadcastToChannel("arena", {
  type: "arena_agent_action",
  data: {
    seatIndex: currentIdx,
    playerName: player.displayName,
    action: action.type,
    amount: action.amount,
    reasoning: action.reasoning,  // NEW: LLM reasoning text (if available from LLM response)
  },
  gameId,
  tableId,
  timestamp: Date.now(),
});
```

The frontend receives this for the action feed display while getting the actual game state change from the chain subscription.

### 5.2 Simplify ArenaManager

**File**: `apps/game-server/src/plugins/arena-manager.ts`

The arena manager becomes a pure lifecycle coordinator:

```typescript
export class ArenaManager {
  private state: ArenaState = "idle";
  private running = false;
  private roundNumber = 0;
  private currentTableId: string | null = null;
  private currentGameId: string | null = null;

  // REMOVED: currentPool, virtualBalances, poolCreatedOnChain,
  //          bettingSecondsRemaining, cooldownSecondsRemaining

  // getStatus() returns only lifecycle data:
  getStatus(): ArenaStatus {
    return {
      state: this.state,
      roundNumber: this.roundNumber,
      currentTableId: this.currentTableId,
      currentGameId: this.currentGameId,
      agents: ARENA_AGENTS,  // static config, no virtual balances
      // Timers are broadcast via WS countdown messages, not polled via REST
    };
  }

  // REMOVED: getPool(), placeBet()
}
```

### 5.3 Simplify WebSocket message types

**File**: Backend `types.ts` and frontend arena types

New slimmer WS message set:

| Message | Direction | Data | Purpose |
|---------|-----------|------|---------|
| `arena_round_start` | Server → Client | `{ tableId, gameId, agents, roundNumber }` | New round — frontend derives PDAs and subscribes |
| `arena_betting_countdown` | Server → Client | `{ secondsRemaining }` | Timer tick |
| `arena_betting_locked` | Server → Client | `{ tableId }` | Betting window closed |
| `arena_gate_failed` | Server → Client | `{ reason }` | Not enough bets |
| `arena_agent_action` | Server → Client | `{ seatIndex, playerName, action, amount, reasoning }` | LLM decision + reasoning |
| `arena_game_end` | Server → Client | `{ winnerIndex, winnerName }` | Game finished |
| `arena_cooldown` | Server → Client | `{ secondsRemaining }` | Cooldown timer |
| `arena_error` | Server → Client | `{ message }` | Error |

Removed:
- `game_state`, `game_action`, `game_start`, `game_end` — replaced by chain subscriptions
- `arena_pool_update` — replaced by BettingPool chain subscription
- `arena_game_complete` with `virtualBalances` — balances derived from chain
- `arena_state_change` — replaced by specific lifecycle messages

### 5.4 Rewrite useArenaWebSocket as useArenaLifecycle

**File**: `apps/web/src/hooks/useArenaWebSocket.ts` → rename to `useArenaLifecycle.ts`

This hook becomes much simpler — it only handles lifecycle events and LLM reasoning:

```typescript
export function useArenaLifecycle() {
  // State:
  const [arenaState, setArenaState] = useState<ArenaState>("idle");
  const [roundNumber, setRoundNumber] = useState(0);
  const [tableId, setTableId] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [agents, setAgents] = useState<ArenaAgentConfig[]>([]);
  const [bettingCountdown, setBettingCountdown] = useState<number | null>(null);
  const [cooldownCountdown, setCooldownCountdown] = useState<number | null>(null);
  const [agentActions, setAgentActions] = useState<AgentActionEvent[]>([]);
  const [lastWinner, setLastWinner] = useState<LastWinner | null>(null);
  const [gateFailedReason, setGateFailedReason] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // NO gameState — that comes from useGameStateSubscription
  // NO poolData — that comes from useBettingPoolSubscription
  // NO actions array — replaced by agentActions (LLM reasoning only)

  // On connect: fetch /api/arena/status for current lifecycle state
  // Handle: arena_round_start, arena_betting_countdown, arena_betting_locked,
  //         arena_gate_failed, arena_agent_action, arena_game_end,
  //         arena_cooldown, arena_error

  return {
    arenaState, roundNumber, tableId, gameId, agents,
    bettingCountdown, cooldownCountdown, agentActions,
    lastWinner, gateFailedReason, isConnected,
  };
}
```

### 5.5 Compose hooks in LiveArena

**File**: `apps/web/src/components/home/LiveArena.tsx` and `apps/web/src/app/page.tsx`

```typescript
// page.tsx
export default function Home() {
  const arena = useArenaLifecycle();  // lifecycle only

  return <LiveArena {...arena} />;
}

// LiveArena.tsx
export default function LiveArena({ arenaState, gameId, tableId, agents, ... }) {
  // Derive PDAs from IDs
  const [gamePda, setGamePda] = useState<Address | null>(null);
  const [poolPda, setPoolPda] = useState<Address | null>(null);

  useEffect(() => {
    if (gameId) deriveGamePda(gameId).then(setGamePda);
    else setGamePda(null);
  }, [gameId]);

  useEffect(() => {
    if (tableId) derivePoolPda(tableId).then(setPoolPda);
    else setPoolPda(null);
  }, [tableId]);

  // Subscribe to on-chain accounts
  const { data: onChainGameState } = useGameStateSubscription(gamePda);
  const holeCards = usePlayerHandsSubscription(gameId, 6);
  const { data: onChainPool } = useBettingPoolSubscription(poolPda);
  const agentsWithStats = useArenaAgentStats(agents);

  // Map on-chain GameState to UI snapshot
  const agentNameMap = useMemo(() => {
    const m = new Map();
    for (const a of agents) m.set(a.pubkey, { displayName: a.displayName, template: a.template });
    return m;
  }, [agents]);

  const gameState = useMemo(() => {
    if (!onChainGameState) return null;
    return mapGameStateToSnapshot(onChainGameState, holeCards, agentNameMap);
  }, [onChainGameState, holeCards, agentNameMap]);

  // Pool data from chain
  const poolData = useMemo(() => ({
    totalPool: onChainPool ? Number(onChainPool.totalPool) / 1e9 : 0,
    agentPools: {},  // per-agent breakdown from server WS or omitted
  }), [onChainPool]);

  // Render using gameState, poolData, agentsWithStats, arena lifecycle state...
}
```

### 5.6 Clean up dead code

Delete or simplify:
- `apps/web/src/lib/adapters.ts` — most functions unused. Keep only what's needed for non-arena pages (tables, agents list). The arena flow uses `chain-adapters.ts` instead.
- `apps/web/src/lib/api.ts` — remove `placeArenaBet()`, `fetchBettingPool()`, `fetchGameState()` (replaced by chain reads). Keep `fetchStats()`, `fetchAgents()`, `fetchLeaderboard()`.
- `apps/game-server/src/routes/arena.ts` — remove `POST /api/arena/bet` and `GET /api/arena/pool`. Keep `GET /api/arena/status` and `GET /api/arena/agents`.
- `apps/game-server/src/routes/games.ts` — `GET /games/:gameId` can be removed for active games (frontend reads from chain). Keep for historical game queries.

---

## Phase 6: Backend Startup Recovery + Agent Stats

### 6.1 Persist round number

**New file**: `apps/game-server/src/lib/arena-persistence.ts`

```typescript
import { writeFileSync, readFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";

interface PersistedState {
  roundNumber: number;
  activeTableId: string | null;  // for orphaned pool cleanup
}

const STATE_FILE = path.join(process.cwd(), ".arena-state.json");

export function loadState(): PersistedState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export function saveState(state: PersistedState): void {
  const tmp = STATE_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(state), "utf-8");
  renameSync(tmp, STATE_FILE);
}
```

### 6.2 ArenaManager startup recovery

**File**: `apps/game-server/src/plugins/arena-manager.ts`

```typescript
async start(): Promise<void> {
  // 1. Restore round number
  const persisted = loadState();
  if (persisted) {
    this.roundNumber = persisted.roundNumber;
  }

  // 2. Ensure arena agents exist on-chain
  await this.ensureArenaAgentsExist();

  // 3. Clean up orphaned pools from previous session
  if (persisted?.activeTableId) {
    await this.cleanupOrphanedPool(persisted.activeTableId);
    saveState({ roundNumber: this.roundNumber, activeTableId: null });
  }

  // 4. Start
  this.running = true;
  this.loop().catch((err) => this.log.error({ err }, "Arena loop crashed"));
}
```

In `runRound()`:
- After creating betting pool: `saveState({ roundNumber, activeTableId: tableId })`
- After round completes: `saveState({ roundNumber, activeTableId: null })`

---

## Implementation Order

```
Phase 1: Subscription infrastructure     (hooks, PDA utils, env vars)
Phase 2: GameState from ER               (useGameStateSubscription + chain-adapters)
Phase 3: BettingPool from L1             (useBettingPoolSubscription)
Phase 4: Agent stats + virtual balances  (backend updateStats + frontend derivation)
Phase 5: Slim down backend + frontend    (remove dead code, simplify WS protocol)
Phase 6: Startup recovery                (persistence + cleanup)
```

Phases 1-3 can be developed and tested independently (add new hooks, verify they work, then swap out the old code in Phase 5).

---

## Files Changed Summary

### New Files
| File | Purpose |
|------|---------|
| `apps/web/src/hooks/useAccountSubscription.ts` | Generic on-chain account subscription hook |
| `apps/web/src/hooks/useGameStateSubscription.ts` | GameState subscription on ER |
| `apps/web/src/hooks/usePlayerHandsSubscription.ts` | PlayerHand subscriptions on ER |
| `apps/web/src/hooks/useBettingPoolSubscription.ts` | BettingPool subscription on L1 |
| `apps/web/src/hooks/useArenaAgentStats.ts` | Fetch AgentAccount stats, derive virtual balances |
| `apps/web/src/lib/pda.ts` | PDA derivation utilities for frontend |
| `apps/web/src/lib/chain-adapters.ts` | On-chain account → UI type mapping |
| `apps/game-server/src/lib/arena-persistence.ts` | JSON file persistence for round number |

### Modified Files
| File | Change |
|------|--------|
| `apps/web/src/lib/constants.ts` | Add RPC/WS endpoint constants |
| `apps/web/src/hooks/useArenaWebSocket.ts` | Rewrite as `useArenaLifecycle` — lifecycle only |
| `apps/web/src/components/home/LiveArena.tsx` | Compose chain subscriptions + lifecycle hook |
| `apps/web/src/app/page.tsx` | Use new hook composition |
| `apps/game-server/src/plugins/arena-manager.ts` | Remove pool/balance tracking, add stats update, add startup recovery |
| `apps/game-server/src/plugins/orchestrator.ts` | Remove activeGames/syncLocalState/broadcastState, add LLM reasoning broadcast |
| `apps/game-server/src/lib/arena-agents.ts` | Export AGENT_KEYPAIRS |
| `apps/game-server/src/plugins/solana-write.ts` | Add createArenaAgent() method |
| `apps/game-server/src/types.ts` | Slim WS message types |
| `apps/game-server/src/routes/arena.ts` | Remove /bet and /pool endpoints |

### Deleted / Heavily Simplified
| File | Change |
|------|--------|
| `apps/web/src/lib/adapters.ts` | Remove arena-specific adapters (keep non-arena ones) |
| `apps/web/src/lib/api.ts` | Remove placeArenaBet, fetchBettingPool, fetchGameState |

---

## Why This Architecture is Right

1. **Page refresh works instantly** — chain subscriptions re-fetch current account state on subscribe. No "missed messages" problem.

2. **Server restart is harmless** — game state is on ER, pool is on L1, agent stats are on L1. The server only needs to recover its round number (from a tiny file) and clean up any orphaned pool.

3. **No state duplication** — the chain is the single source of truth. The server doesn't maintain a parallel copy of game state, pool state, or virtual balances.

4. **Verifiable** — anyone can read the on-chain accounts and independently verify game state, betting pools, and agent statistics. Virtual balances are a deterministic function of on-chain stats.

5. **The server does what only a server can do** — sign transactions (authority key), call LLMs (API keys), manage timers (countdowns). Everything else comes from chain.
