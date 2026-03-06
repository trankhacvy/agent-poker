# AgentPoker — Game Modes

AgentPoker supports three distinct game modes, each targeting a different user experience. All modes share the same core poker engine (MagicBlock PER), LLM gateway, and on-chain settlement infrastructure.

---

## Overview

| | Mode 1: Arena | Mode 2: Player vs Agent | Mode 3: Player vs Players |
|---|---|---|---|
| **Status** | Implemented | Planned | Planned |
| **Concept** | 6 system AI agents play continuously; humans bet on outcomes | AI agent hosts a table; human players join and play | Human players only, no AI |
| **Who plays** | System agents only | 1 AI agent (host) + 1-5 human players | 2-6 human players |
| **Who bets** | Spectators | No spectator betting | No spectator betting |
| **Wagering** | Virtual agent balances + real spectator bets (SOL) | Real SOL buy-in via escrow | Real SOL buy-in via escrow |
| **LLM usage** | All 6 players are LLM-driven | Only the host agent uses LLM | None |
| **Player count** | Always 6 | 2-6 (1 agent + 1-5 humans) | 2-6 |
| **Game trigger** | Automatic loop (betting window -> play -> cooldown -> repeat) | Agent creates table, humans join, game starts when full or host starts | Host creates table, players join, game starts when full or host starts |
| **Revenue** | 5% rake on spectator betting pool | 5% rake on pot via escrow | 5% rake on pot via escrow |

---

## Mode 1: Arena (Implemented)

### Concept

A continuous spectator-first experience. Six pre-defined system agents (Shark, Maniac, Rock, Fox, Owl, Wolf) play poker in an infinite loop. Spectators drive the action by betting SOL on which agent wins each round.

### Why Arena First

- No user onboarding friction — spectators just connect wallet and bet
- Creates "always live" content without waiting for players to join
- Showcases AI personality differences (each agent has a unique LLM template)
- Revenue from spectator betting rake funds platform operations

### Current Implementation

**Server**: `ArenaManager` plugin (`apps/game-server/src/plugins/arena-manager.ts`)

State machine loop:
```
idle -> betting (60s) -> gate check -> playing -> cooldown (30s) -> repeat
```

- **6 system agents** defined in `apps/game-server/src/lib/arena-agents.ts` with deterministic keypairs (SHA-256 of seed strings)
- **Virtual balances**: Each agent starts at 100. Winner gets +10, losers get -2 (min 50). Display-only, not real SOL.
- **Betting gate**: If `ARENA_REQUIRE_BETS=true`, at least 2 different agents must receive bets. Gate failure cancels/refunds all bets and restarts immediately (no cooldown).
- **On-chain betting**: Uses the Spectator Betting Program (`cancel_pool`, `refund_bet`, `close_pool` instructions added for arena)
- **ER retry**: Up to 2 attempts on MagicBlock cloner errors with 15s backoff

**Frontend**: Single-page arena at `/` (`apps/web/src/components/home/LiveArena.tsx`)

- **Betting phase**: 3x2 agent card grid, countdown timer, betting panel
- **Playing phase**: PokerTable component with live game state, action feed
- **Cooldown phase**: Winner banner, updated virtual balances, next round countdown

**WebSocket**: Arena channel subscription (`{ type: "subscribe", channel: "arena" }`)

Message types: `arena_state_change`, `arena_betting_open`, `arena_betting_countdown`, `arena_betting_locked`, `arena_pool_update`, `arena_gate_failed`, `arena_game_complete`, `arena_game_failed`, `arena_cooldown`, `arena_error`

**Config**:
- `ARENA_MODE_ENABLED` — enables arena mode (disables classic auto-queue)
- `ARENA_REQUIRE_BETS` — whether betting gate is enforced

### Arena Data Flow

```
1. ArenaManager creates on-chain BettingPool
2. Broadcast arena_betting_open → 60s betting window
3. Users place bets: wallet signs on-chain place_bet tx → POST /api/arena/bet with txSignature
4. Server verifies tx, tracks off-chain for real-time WS pool updates
5. Gate check: 2+ agents with bets? (skipped if ARENA_REQUIRE_BETS=false)
   - FAIL: cancel_pool → refund_bet per bettor → close_pool → restart
   - PASS: lock_pool → play game
6. Orchestrator runs full game (create → join → delegate → VRF → betting rounds → showdown → commit)
7. settle_pool(winnerIndex) on-chain → winners claim_winnings pro-rata
8. Update virtual balances, broadcast arena_game_complete
9. 30s cooldown → next round
```

### Files

| File | Role |
|------|------|
| `apps/game-server/src/plugins/arena-manager.ts` | Arena loop state machine |
| `apps/game-server/src/lib/arena-agents.ts` | 6 system agent definitions |
| `apps/game-server/src/routes/arena.ts` | REST endpoints (status, agents, pool, bet) |
| `apps/web/src/hooks/useArenaWebSocket.ts` | Arena WS hook |
| `apps/web/src/components/home/LiveArena.tsx` | Arena UI (3-phase rendering) |
| `apps/web/src/components/arena/ArenaAgentCard.tsx` | Agent card component |
| `apps/web/src/lib/arena-types.ts` | Frontend arena types |
| `programs/agent-poker-betting/src/lib.rs` | Betting program with cancel/refund/close |

---

## Mode 2: Player vs Agent (Planned)

### Concept

An AI agent acts as the "house" — it hosts a table and human players join to play against it. Think online poker vs a dealer bot, but the bot is an LLM with a personality. No spectator betting. Real SOL wagers via escrow.

This is the bridge between spectating (Mode 1) and full PvP (Mode 3). Users get to play real poker while the AI ensures there's always an opponent.

### Design

#### User Flow

```
1. User picks an AI agent host (from available agent templates)
2. Server creates a table with the AI agent already seated
3. Other users browse open tables and join (connect wallet, approve buy-in)
4. When table has 2+ players (1 AI + 1+ human), host can start OR auto-starts at 6
5. Game plays: humans submit actions from frontend, AI uses LLM
6. Winner takes pot minus 5% rake
7. Table stays open for next hand (or dissolves)
```

#### Key Differences from Arena

| Aspect | Arena | Player vs Agent |
|--------|-------|-----------------|
| Player actions | All LLM | Humans submit via frontend; AI via LLM |
| Action input | N/A (automated) | Frontend UI: fold/check/call/raise buttons + raise slider |
| Turn timer | None (LLM responds in 5-30s) | 30s per human turn (auto-fold on timeout) |
| Wager | Virtual (display-only) | Real SOL via Escrow Program |
| Settlement | Virtual balance update | On-chain escrow settle (95% to winner, 5% rake) |
| Betting | Spectator side-bets | None |
| Agent creation | Fixed system agents | Any template; server creates on-chain agent account |
| Table lifecycle | Continuous loop | Per-hand or per-session |

#### Architecture Changes

**Orchestrator changes**:
- The orchestrator currently drives ALL players via LLM. For Mode 2, the orchestrator needs to distinguish between AI players and human players.
- For AI players: continue using `llmGateway.getAction()` as today.
- For human players: broadcast `your_turn` WS message, wait for human input (with timeout), then submit the action on-chain.
- New turn flow:
  ```
  if (player.isHuman) {
    broadcast your_turn to player's WS connection
    wait for action from WS (30s timeout, auto-fold)
  } else {
    action = await llmGateway.getAction(template, state, seatIndex)
  }
  submit playerAction on-chain
  ```

**New types needed**:
```typescript
// Extend PlayerInfo
interface PlayerInfo {
  pubkey: string;
  displayName: string;
  template: number;
  seatIndex: number;
  isHuman: boolean;     // NEW: true for human players
  walletPubkey?: string; // NEW: human's wallet for WS routing
}

// New WS message types
type WsMessage["type"] =
  | ... existing ...
  | "your_turn"        // server -> specific human player
  | "player_action"    // human player -> server (their action)
  | "turn_timeout"     // server -> player (you were auto-folded)
```

**WebSocket changes**:
- Need per-player messaging (not just broadcast). The WS feed already tracks clients by socket. Add a way to route messages to a specific wallet.
- Human players subscribe to their table AND authenticate their wallet on connect.
- `broadcastToPlayer(walletPubkey, message)` method on WsFeed.

**Frontend changes**:
- New `/play` page or `/tables/:tableId/play` view
- Action buttons: Fold, Check, Call ($X), Raise (slider), All-In
- Turn indicator with countdown timer
- Hole cards shown face-up to the owning player only (fetched via player-specific endpoint)
- Table lobby UI: browse open agent-hosted tables, see buy-in tier, join button

**Escrow integration**:
- Human players buy-in via `join_table` on the Escrow Program (same as current classic mode)
- AI host agent needs a funded on-chain agent account (system-funded or operator-funded)
- Settlement via `settle_table` — winner gets 95%, treasury gets 5%

**Table lifecycle**:
- Option A: Single-hand tables (create → play → settle → close)
- Option B: Persistent tables (multiple hands, rebuy allowed, agent stays seated)
- MVP: Option A (simpler). Option B for later.

**New plugin**: `PvAManager` (Player vs Agent Manager)
- Creates a table with an AI host pre-seated
- Exposes REST endpoints: `POST /api/pva/create` (pick template + wager tier), `GET /api/pva/tables`
- Manages table lifecycle: waiting for players → game → settlement → next hand or close
- Handles human turn timeouts

#### On-Chain Changes

Minimal. The existing programs already support this:
- Escrow Program: `create_table` → `join_table` × N → `start_game` → `settle_table` works as-is
- Game Program: `player_action` doesn't care who submits (authority signs all actions)
- The server is the authority for all on-chain actions, so human actions are mediated through the server (user submits via WS, server validates and submits on-chain)

One consideration: the current Game Program has the server authority submit ALL `player_action` transactions. This means the server must validate that human-submitted actions are legal (correct player, valid action type, sufficient chips). The on-chain program also validates, but server-side validation gives better error messages.

#### Hole Card Privacy

In Arena mode, the server knows all hands and broadcasts them (spectator view). In PvA mode:
- Each human should only see their own hole cards
- Other players' cards should be hidden (face-down) until showdown
- The server fetches hands from ER. For human players, only send their cards in `your_turn` / `game_state` messages, filter out other players' `holeCards`.

```typescript
function filterStateForPlayer(state: GameStateSnapshot, playerIndex: number): GameStateSnapshot {
  return {
    ...state,
    players: state.players.map((p, i) => ({
      ...p,
      holeCards: i === playerIndex ? p.holeCards : undefined,
    })),
  };
}
```

---

## Mode 3: Player vs Players (Planned)

### Concept

Pure PvP poker. No AI agents involved. Human players create or join tables and play against each other with real SOL wagers. This is the endgame — a decentralized poker platform.

### Design

#### User Flow

```
1. User creates a table (picks wager tier)
   OR browses open tables and joins one
2. Players join by connecting wallet and approving buy-in
3. Game starts when table is full (6 players) or host manually starts (2+ players)
4. Standard Texas Hold'em: each player submits actions via frontend
5. Winner takes pot minus 5% rake
6. Table can persist for multiple hands or close
```

#### Key Differences from Mode 2

| Aspect | Player vs Agent | Player vs Players |
|--------|-----------------|-------------------|
| AI involvement | 1 AI host | None |
| LLM usage | Yes (for AI) | No |
| Who creates table | Server (for AI host) | Any user |
| Min players | 2 (1 AI + 1 human) | 2 humans |
| Cost per game | ~$0.07 (L1 + ER + VRF + LLM) | ~$0.07 (L1 + ER + VRF, no LLM) |
| Always available | Yes (AI always ready) | Depends on player pool |

#### Architecture Changes

**Orchestrator changes**:
- Same human-turn flow as Mode 2, but ALL players are human
- No LLM calls at all — pure WS action collection with timeouts
- The orchestrator loop simplifies to:
  ```
  while (game not over):
    broadcast your_turn to current player
    wait for action (30s timeout → auto-fold)
    submit playerAction on-chain
    sync state from ER
    broadcast updated state to all table subscribers
  ```

**New plugin**: `PvPManager` (or extend PvAManager to handle both)
- Table creation by any authenticated user
- Table browsing with filters (wager tier, player count, open seats)
- Sit-and-go: auto-start when full, or host-triggered start at 2+
- Multi-hand support: auto-deal next hand if players remain seated
- Player disconnect handling: 60s reconnect window, then auto-fold remaining actions

**Frontend changes**:
- Table creation UI: pick wager tier, set min/max players
- Lobby: real-time table list with WebSocket updates (player joins/leaves)
- In-game: same action UI as Mode 2
- Chat? Optional — could add table chat for social element

**Matchmaking** (optional enhancement):
- Quick-play: server auto-matches players at same wager tier
- Reuse existing Matchmaker plugin queue logic
- Or keep it simple: manual table browsing only for MVP

#### On-Chain Changes

None. The existing programs handle PvP identically to PvA from the chain's perspective. The server authority submits all transactions regardless of who decided the action.

#### Considerations

**Anti-collusion**: With real money PvP, collusion becomes a concern. Players at the same table could share hole card info externally. Mitigations:
- Short-term: logging and post-game analysis
- Long-term: account reputation system, flagging suspicious patterns

**Disconnect handling**: Unlike AI (which never disconnects), human players may lose connection. Need:
- Reconnect grace period (60s)
- Auto-fold on timeout
- Refund if game can't continue (too few players)
- The ER timeout handling needs care — the game state is delegated to PER, and the server must continue submitting actions even if the human disconnected (auto-fold)

**Scalability**: Multiple concurrent PvP tables will be common. Each table needs:
- Its own game on ER
- Its own WS broadcast channel (`table:<tableId>`)
- Its own turn timer
- The orchestrator needs to handle parallel games (currently it's sequential per ArenaManager round). This likely means spawning a game runner per table.

---

## Shared Infrastructure Across Modes

### What's Reused

| Component | Mode 1 | Mode 2 | Mode 3 |
|-----------|--------|--------|--------|
| Game Program (ER) | Yes | Yes | Yes |
| VRF shuffle | Yes | Yes | Yes |
| Escrow Program | No (virtual) | Yes | Yes |
| Betting Program | Yes | No | No |
| Agent Program | No (system agents) | Yes (AI host) | No |
| Orchestrator core loop | Yes | Modified | Modified |
| LLM Gateway | Yes (all players) | Yes (AI only) | No |
| WebSocket Feed | Yes (broadcast) | Yes (broadcast + per-player) | Yes (broadcast + per-player) |
| PokerTable component | Yes | Yes | Yes |
| BettingPanel component | Yes | No | No |
| Action buttons UI | No | Yes | Yes |

### What's New Per Mode

**Mode 2 (Player vs Agent)**:
- `PvAManager` plugin
- Human turn WS protocol (`your_turn`, `player_action`, `turn_timeout`)
- `broadcastToPlayer()` on WsFeed
- Action buttons frontend component
- Per-player state filtering (hide other players' cards)
- Turn timer (30s)

**Mode 3 (Player vs Players)**:
- `PvPManager` plugin (or extend PvA)
- Table creation by users (not just server)
- Table lobby UI
- Disconnect/reconnect handling
- Parallel game runner (multiple concurrent tables)
- Optional: matchmaking queue for quick-play

---

## Implementation Priority

```
Phase 1 (Current): Arena Mode .......................... DONE
  - ArenaManager, system agents, betting flow, arena UI

Phase 2 (Next): Player vs Agent
  - Extend orchestrator for mixed human/AI turns
  - Human turn WS protocol + action UI
  - PvAManager plugin + routes
  - Per-player state filtering
  - Escrow integration for human buy-in

Phase 3: Player vs Players
  - PvPManager plugin (builds on PvA infrastructure)
  - Table creation by users
  - Lobby UI
  - Disconnect handling
  - Parallel game support

Phase 4: Polish
  - Multi-hand sessions (persistent tables)
  - Matchmaking queue
  - Spectator betting on PvP tables (optional)
  - Anti-collusion monitoring
  - Mobile-responsive action UI
```

---

## Mode Selection Architecture

The server already uses conditional plugin loading based on `ARENA_MODE_ENABLED`. For multi-mode support, this should evolve to support all modes simultaneously:

```typescript
// Current (single mode):
if (fastify.env.ARENA_MODE_ENABLED) {
  await fastify.register(arenaManagerPlugin);
} else {
  await fastify.register(autoQueuePlugin);
  await fastify.register(gameLifecyclePlugin);
}

// Future (all modes coexist):
await fastify.register(arenaManagerPlugin);   // Always on — continuous entertainment
await fastify.register(pvaManagerPlugin);     // Player vs Agent tables
await fastify.register(pvpManagerPlugin);     // Player vs Player tables
// autoQueue and gameLifecycle retired — replaced by mode-specific managers
```

Each mode manager registers its own routes under a prefix:
- `/api/arena/*` — Arena endpoints
- `/api/pva/*` — Player vs Agent endpoints
- `/api/pvp/*` — Player vs Player endpoints

The frontend uses a tab or navigation to switch between modes, with the arena as the default landing page.
