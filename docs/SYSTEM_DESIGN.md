# AgentPoker — System Design

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SOLANA L1 (Devnet)                           │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │ Agent Program │  │  Settlement  │  │ Spectator Betting Program │ │
│  │  - Create     │  │  (Escrow)    │  │  - Create pool            │ │
│  │  - Fund       │  │  - Sessions  │  │  - Place bet              │ │
│  │  - Stats      │  │  - Deposit   │  │  - Settle / Cancel        │ │
│  │               │  │  - Settle    │  │                           │ │
│  └──────────────┘  └──────────────┘  └───────────────────────────┘ │
│                            │                                        │
│                      ┌─────┴─────┐                                  │
│                      │ Delegate  │                                  │
│                      └─────┬─────┘                                  │
└────────────────────────────┼────────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │  MagicBlock PER (TEE Node)   │
              │                              │
              │  ┌────────────────────────┐  │
              │  │   Poker Game Program   │  │
              │  │  - Hidden hands (TEE)  │  │
              │  │  - Betting rounds      │  │
              │  │  - Showdown logic      │  │
              │  └────────────────────────┘  │
              │  ┌────────────────────────┐  │
              │  │    MagicBlock VRF      │  │
              │  │  - Deck shuffle        │  │
              │  └────────────────────────┘  │
              └──────────────┬──────────────┘
                             │ game events
              ┌──────────────┴──────────────┐
              │     Game Server (Fastify)    │
              │  - Turn Orchestrator         │
              │  - LLM Gateway              │
              │  - Arena Manager            │
              │  - WebSocket Feed           │
              └──────────────┬──────────────┘
                             │ websocket
              ┌──────────────┴──────────────┐
              │     Frontend (Next.js)       │
              │  - Live arena spectating     │
              │  - Agent management          │
              │  - Spectator betting UI      │
              └──────────────────────────────┘
```

**Three-layer architecture:**

- **Layer 1 (Solana L1)**: Settlement, agent management, escrow, betting pools
- **Layer 2 (MagicBlock PER/TEE)**: Private game execution, VRF card dealing, fast transactions (~50ms)
- **Layer 3 (Off-chain)**: Game orchestration, LLM decision-making, WebSocket spectator feed

---

## 2. On-Chain Programs (Solana / Anchor)

### 2.1 Agent Program (`agent-poker-agent`)

Manages AI agent creation, funding, and stats on L1.

**Account PDAs:**

| Account | Seeds | Description |
|---------|-------|-------------|
| `Agent` | `[b"agent", owner_pubkey]` | Stores template, stats, vault reference |
| `AgentVault` | `[b"agent_vault", owner_pubkey]` | SystemAccount holding SOL |

**Account Structure:**

```
AgentAccount
├── owner: Pubkey              // wallet that owns this agent
├── template: u8               // 0=Shark, 1=Maniac, 2=Rock, 3=Fox, 4=Owl, 5=Wolf
├── display_name: String       // max 20 chars
├── vault: Pubkey              // agent's SOL wallet (PDA)
├── total_games: u64
├── total_wins: u64
├── total_earnings: i64        // net profit/loss in lamports (signed)
├── created_at: i64
├── bump: u8
└── vault_bump: u8
```

**Instructions:**

| Instruction | Access Control | Description |
|-------------|----------------|-------------|
| `create_agent(template, display_name)` | Owner (signer) | Creates AgentAccount + vault PDA. One agent per wallet. |
| `fund_agent(amount)` | Owner (signer, `has_one = owner`) | Transfer SOL from owner wallet to agent vault PDA |
| `withdraw(amount)` | Owner (signer, `has_one = owner`) | Transfer SOL from agent vault PDA back to owner |
| `update_stats(games_delta, wins_delta, earnings_delta)` | Authority (signer) | Increment/decrement stats after each game. Signed arithmetic for losses. |

### 2.2 Escrow Program (`agent-poker-escrow`)

Generic session-based settlement program. Game-agnostic — can handle any game type with flexible multi-recipient payouts and 5% rake.

**Account PDAs:**

| Account | Seeds | Description |
|---------|-------|-------------|
| `Session` | `[b"session", session_id_bytes]` | Tracks depositors, deposits, status |
| `SessionVault` | `[b"session_vault", session_id_bytes]` | SystemAccount holding all deposited SOL |
| `Treasury` | `[b"treasury"]` | Singleton rake collector |

**Account Structure:**

```
Session
├── session_id: u64
├── game_type: u8              // extensible game type tag
├── depositors: [Pubkey; 6]    // depositor pubkeys
├── deposits: [u64; 6]         // deposit amounts (parallel array)
├── deposit_count: u8
├── total_deposited: u64
├── status: enum { Open, Locked, Settled, Cancelled }
├── authority: Pubkey
├── created_at: i64
├── bump: u8
└── vault_bump: u8
```

**Instructions:**

| Instruction | Access Control | Description |
|-------------|----------------|-------------|
| `initialize_treasury()` | Authority | Creates singleton treasury PDA (idempotent via `init_if_needed`) |
| `create_session(session_id, game_type)` | Authority | Creates session with status=Open |
| `deposit(amount)` | Depositor (signer) | Transfers SOL from depositor to session vault. Rejects duplicates before checking capacity. Max 6 depositors. |
| `lock_session()` | Authority (`has_one`) | Transitions Open → Locked. Requires at least 1 deposit. |
| `settle(payouts: Vec<Payout>)` | Authority (`has_one`) | Distributes 95% to recipients via `remaining_accounts`, 5% rake to treasury. Validates `sum(payouts) == total_deposited - rake`. |
| `refund_session()` | Authority (`has_one`) | Returns each deposit to original depositor via `remaining_accounts`. Open or Locked sessions only. Sets status=Cancelled. |

**Financial Flow:**

```
deposit:  depositor_wallet → session_vault (any amount)
settle:   session_vault → payout recipients (95% via remaining_accounts)
          session_vault → treasury (5% rake)
refund:   session_vault → each depositor (exact deposit amount)
```

**Key Design Decisions:**
- **Game-agnostic**: No CPI to game program. Session is identified by `session_id` and `game_type` tag.
- **Flexible payouts**: `settle()` takes `Vec<Payout>` with `{recipient, amount}` pairs — supports winner-takes-all, split pots, or any distribution.
- **Duplicate check first**: `deposit()` checks for duplicate depositor before capacity check, ensuring correct error codes.

### 2.3 Spectator Betting Program (`agent-poker-betting`)

Side-betting on game outcomes, independent from the game program.

**Account PDAs:**

| Account | Seeds | Description |
|---------|-------|-------------|
| `BettingPool` | `[b"bet_pool", table_id_bytes]` | Pool for a table with 6 agent pubkeys, status, winner |
| `PoolVault` | `[b"pool_vault", pool_pubkey]` | SystemAccount holding all spectator bets |
| `BetAccount` | `[b"bet", pool_pubkey, bettor_pubkey]` | Per-bettor record with amount, agent index, claimed flag |

**Instructions:**

| Instruction | Access Control | Description |
|-------------|----------------|-------------|
| `create_pool(table_id, agents)` | Authority | Pool for table with 6 agent pubkeys, status=Open |
| `place_bet(agent_index, amount)` | Bettor (signer) | Bet on agent (0-5), transfers SOL to pool vault, creates BetAccount |
| `lock_pool()` | Authority | Transitions Open to Locked (no more bets) |
| `settle_pool(winner_index)` | Authority | Sets winner, transfers 5% rake to treasury |
| `cancel_pool()` | Authority | Marks as Cancelled for refund window |
| `refund_bet()` | Bettor | Refunds individual cancelled bet |
| `close_pool()` | Authority | Drains remaining vault to authority |
| `claim_winnings()` | Bettor | Pro-rata payout: `(bet.amount * pool_after_rake) / winning_pool_total` |

### 2.4 Poker Game Program (`agent-poker-game`)

Core poker engine running on MagicBlock Ephemeral Rollups. Annotated with `#[ephemeral]`.

**Account PDAs:**

| Account | Seeds | Description |
|---------|-------|-------------|
| `GameState` | `[b"poker_game", game_id_bytes]` | Phase, pot, deck[52], community_cards[5], player data — DELEGATED TO PER |
| `PlayerHand` | `[b"player_hand", game_id_bytes, seat_index]` | 2 hole cards per player — created dynamically via `remaining_accounts`, PERMISSIONED |

**GameState Structure:**

```
GameState (delegated to PER)
├── game_id: u64
├── table_id: u64
├── wager_tier: u64
├── phase: enum { Waiting, Preflop, Flop, Turn, River, Showdown, Complete }
├── deck: [u8; 52]            // shuffled deck (PRIVATE — only TEE can read)
├── community_cards: [u8; 5]  // revealed progressively
├── community_count: u8
├── pot: u64                   // current pot in lamports
├── current_bet: u64           // current bet to call
├── dealer_index: u8           // button position
├── current_player: u8         // whose turn (0-5)
├── player_count: u8
├── players: [Pubkey; 6]
├── player_status: [u8; 6]    // 0=empty, 1=active, 2=folded, 3=all_in
├── player_bets: [u64; 6]
├── last_raiser: u8
├── winner_index: u8
├── last_action_at: i64
└── bump: u8
```

**Instructions:**

| Instruction | Description |
|-------------|-------------|
| `create_game(game_id, table_id, wager_tier)` | Creates GameState only (no PlayerHands). Inline CPI to create permission + delegate permission for GameState PDA. phase=Waiting |
| `join_game(game_id, seat_index, player_pubkey)` | Register player at seat. Init PlayerHand account + inline CPI to create permission + delegate permission for hand PDA. Each hand is created on-demand when its player joins. |
| `start_game(game_id)` | Delegate GameState to ER (permission already created in `create_game`) |
| `request_shuffle(game_id, client_seed)` | CPI to MagicBlock VRF program. PlayerHand accounts passed via `remaining_accounts` (verified by PDA derivation). |
| `callback_shuffle(randomness)` | VRF callback: Fisher-Yates shuffle, deal cards to PlayerHands via `remaining_accounts`, post blinds, phase=Preflop |
| `player_action(action, raise_amount)` | Fold/Check/Call/Raise/AllIn. Validates turn, updates pot/bets, advances phase. |
| `showdown()` | Evaluate all remaining hands (7-card best-5) via `remaining_accounts`, determine winner, emit GameFinished event |
| `commit_game()` | Undelegate GameState from PER back to L1 via `commit_and_undelegate_accounts` |

**Dynamic Hands via `remaining_accounts`:**

PlayerHand accounts are NOT hardcoded as `hand0..hand5` in instruction account structs. Instead, they are passed via `remaining_accounts` and verified by PDA seed derivation (`[b"player_hand", game_id, seat_index]`). This allows any number of players (2-6) without fixed account layouts.

**Blind Calculation:**

- Small blind: `wager_tier * 50 / 1000` (5% of buy-in)
- Big blind: `wager_tier * 100 / 1000` (10% of buy-in)

**Hand Evaluation:** 7-card best-5-card evaluator (`hand_eval.rs`). Ranks 1-9 (high card to straight flush) with sub-rank tiebreakers. Evaluates all C(7,5) = 21 combinations.

**Phase Advancement:** Automatic when only 1 active player remains OR all active players have acted after last raiser. Resets per-round bets, moves current_player clockwise.

### 2.5 Cross-Program Relationships

```
Agent (standalone):
  Manages agent creation, funding, stats. No CPI to other programs.

Escrow (standalone, game-agnostic):
  Generic session-based settlement. No CPI to game or agent programs.
  Identified by session_id + game_type. Server coordinates deposits and settlement.

Game → MagicBlock:
  Inline CPI to MagicBlock permission program (create_permission, delegate_permission)
  during create_game (for GameState) and join_game (for PlayerHand).
  CPI to MagicBlock VRF program for card dealing.
  Uses commit_and_undelegate_accounts to return state to L1.

No Game → Escrow CPI:
  Off-chain orchestrator coordinates settlement after game completes.
  Game and escrow programs are loosely coupled through the server.

Betting is independent:
  Keyed by table_id, managed by server alongside game lifecycle.
```

---

## 3. MagicBlock Integration

### 3.1 Purpose

Solves poker's fundamental problem: **hidden information on a public blockchain**.

| Problem | Solution |
|---------|----------|
| Hidden cards | TEE (Trusted Execution Environment) keeps hands private |
| Fair dealing | On-chain VRF (Verifiable Random Function) |
| Settlement | Solana L1 escrow |
| Speed | PER ~50ms per tx (vs L1 ~400ms) |

### 3.2 Delegation Flow

```
L1: create_game → GameState created + permission + delegate_permission (inline CPI)
  ↓
L1: join_game × N → Each PlayerHand created + permission + delegate_permission (inline CPI)
  ↓
L1→ER: start_game → GameState delegated to ER
  ↓
ER: VRF shuffle, betting rounds, showdown (fast, private)
  ↓
ER→L1: commit_game → commit_and_undelegate_accounts back to L1
  ↓
L1: Settlement via escrow program (optional)
```

Detailed steps:

1. `create_game`: Creates GameState on L1. Inline CPI creates permission + delegates permission for GameState PDA.
2. `join_game` (× N players): Each call inits a PlayerHand account and inline CPI creates permission + delegates permission for that hand PDA.
3. `start_game`: Delegates GameState to ER (permission already exists from step 1).
4. No empty hand delegation step — only actual player hands are created/delegated.
5. Game plays out inside PER (~50ms per transaction). PlayerHands accessed via `remaining_accounts`.
6. On `commit_game`: GameState undelegated back to L1.
7. Settlement + stats updates execute on L1.

### 3.3 VRF Card Dealing

```
Deck representation: [0..51] where:
  card_value = index % 13    // 0=2, 1=3, ..., 8=T, 9=J, 10=Q, 11=K, 12=A
  card_suit  = index / 13    // 0=Hearts, 1=Diamonds, 2=Clubs, 3=Spades

Shuffle algorithm (inside VRF callback):
  seed = vrf_randomness  // [u8; 32] from MagicBlock VRF
  for i in (1..52).rev() {
      j = random_u8_with_range(seed, i+1)  // MagicBlock helper
      deck.swap(i, j)
  }

Deal:
  players[0].hand = [deck[0], deck[1]]
  players[1].hand = [deck[2], deck[3]]
  ...
  community = [deck[12], deck[13], deck[14], deck[15], deck[16]]
```

1. `request_shuffle` sends randomness request to ephemeral oracle queue
2. Oracle returns 32-byte randomness to `callback_shuffle`
3. Fisher-Yates shuffle using `random_u8_with_range` for each card swap
4. Deals: 12 hole cards (2 per player) + 5 community cards
5. Calculates and posts blinds
6. Advances phase to Preflop

### 3.4 Anchor Macros

- `#[ephemeral]` on the game program module
- `#[delegate]` on JoinGame, StartGame account structs
- `#[commit]` on Showdown, CommitGame account structs
- `#[vrf]` on RequestShuffle account struct

---

## 4. Game Server

The game server is the orchestrator. It does NOT make game decisions — it feeds state to LLMs and submits their decisions as transactions.

### 4.1 Plugin Architecture

Fastify 5 with strict dependency-ordered plugin registration:

```
apps/game-server/src/
├── plugins/
│   ├── env.ts                  # Zod env validation → fastify.env
│   ├── error-handler.ts        # Centralized error formatting
│   ├── game-tracker.ts         # Active game counter → fastify.gameTracker
│   ├── solana-read.ts          # OnChainReader class → fastify.solanaRead
│   ├── solana-write.ts         # SolanaClient class → fastify.solanaWrite
│   ├── llm.ts                  # LlmGateway class → fastify.llm
│   ├── websocket-feed.ts       # WsFeed class → fastify.wsFeed
│   ├── matchmaker.ts           # Matchmaker class → fastify.matchmaker
│   ├── orchestrator.ts         # Orchestrator class → fastify.orchestrator
│   ├── auto-queue.ts           # AutoQueue class → fastify.autoQueue
│   ├── arena-manager.ts        # ArenaManager class → fastify.arenaManager
│   ├── game-lifecycle.ts       # Event wiring (bettingLocked, queueTimeout)
│   └── index.ts                # Registers all plugins in dependency order
├── routes/
│   ├── agents.ts               # GET /api/agents, GET /api/agents/:pubkey
│   ├── games.ts                # GET /api/games/:gameId, GET /api/games/agent/:pubkey
│   ├── leaderboard.ts          # GET /api/leaderboard
│   ├── queue.ts                # POST /api/queue/join
│   ├── tables.ts               # GET /api/tables, GET /api/tables/:tableId, betting
│   ├── stats.ts                # GET /api/stats
│   ├── arena.ts                # GET/POST /api/arena/* (status, agents, pool, bet)
│   └── index.ts                # Barrel, all under /api prefix
├── schemas/                    # TypeBox request/response schemas
├── lib/
│   ├── hand-evaluator.ts       # evaluateHand() for LLM context
│   ├── templates.ts            # 6 agent personality templates
│   └── arena-agents.ts         # 6 fixed arena agent definitions
├── types.ts                    # Core TS interfaces
├── app.ts                      # buildApp() factory (testable)
└── server.ts                   # Slim: import dotenv, buildApp(), listen
```

**Plugin Registration Order:**

```
Layer 0 (no deps):     @fastify/cors, @fastify/websocket, env, error-handler, game-tracker
Layer 1 (env):         solana-read, solana-write, llm
Layer 2 (env):         websocket-feed (registers /ws route)
Layer 3 (services):    matchmaker, orchestrator
Layer 4 (conditional): arena-manager OR (auto-queue + game-lifecycle)
```

**Fastify Decorators:**

```typescript
declare module "fastify" {
  interface FastifyInstance {
    env: Env;                   // Zod-validated environment
    solanaRead: OnChainReader;  // Read-only on-chain queries
    solanaWrite: SolanaClient;  // On-chain transactions (Anchor)
    llm: LlmGateway;           // LLM provider abstraction
    wsFeed: WsFeed;             // WebSocket broadcast
    matchmaker: Matchmaker;     // Queue + betting windows
    orchestrator: Orchestrator; // Game execution loop
    autoQueue: AutoQueue;       // Automatic agent pairing (classic mode)
    arenaManager: ArenaManager; // Arena mode state machine
    gameTracker: GameTracker;   // Active game count
  }
}
```

**Conditional Mode Loading:**

```typescript
// Current (single mode):
if (fastify.env.ARENA_MODE_ENABLED) {
  await fastify.register(arenaManagerPlugin);
} else {
  await fastify.register(autoQueuePlugin);
  await fastify.register(gameLifecyclePlugin);
}
```

### 4.2 Environment Configuration

Validated at startup via Zod. Server fails fast on invalid config.

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3001 |
| `LLM_PROVIDER` | `"gemini"` or `"openrouter"` | `"gemini"` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key | — |
| `OPENROUTER_API_KEY` | OpenRouter API key | — |
| `SOLANA_RPC_URL` | Solana RPC endpoint | devnet |
| `AUTHORITY_PRIVATE_KEY` | Base58 private key (deployments) | — |
| `AUTHORITY_KEYPAIR_PATH` | Path to JSON keypair file (local dev) | — |
| `EPHEMERAL_PROVIDER_ENDPOINT` | MagicBlock ER RPC endpoint | — |
| `EPHEMERAL_WS_ENDPOINT` | MagicBlock ER WebSocket endpoint | — |
| `ARENA_MODE_ENABLED` | Enables arena mode (disables classic auto-queue) | `"true"` |
| `ARENA_REQUIRE_BETS` | Whether betting gate is enforced | `"true"` |
| `AUTO_MATCH_INTERVAL_MS` | Auto-queue check interval | 10000 |
| `AUTO_MATCH_ENABLED` | Enable auto-queue | `"true"` |

At least one of `AUTHORITY_PRIVATE_KEY` or `AUTHORITY_KEYPAIR_PATH` must be set.

### 4.3 Turn Orchestrator Loop

```
async runGame(config: GameConfig):
    // 1. Create game on L1 (+ inline CPI: create_permission + delegate_permission for GameState)
    await solanaWrite.createGame(gameId, tableId, wagerTier)

    // 2. Join all players on L1 (each call inits PlayerHand + permission + delegation)
    for player in players:
        await solanaWrite.joinGame(gameId, player.seatIndex, player.pubkey)

    // 3. Start game (delegates GameState to ER — permission already exists)
    await solanaWrite.startGame(gameId)

    // 4. Wait for GameState to appear on ER (poll up to 60s)
    await solanaWrite.waitForErAccount(gamePda)

    // 5. Request VRF shuffle on ER (passes PlayerHands via remainingAccounts)
    await solanaWrite.requestShuffle(gameId, players.length)

    // 6. Poll for VRF callback (up to 120s, phase changes from Waiting)
    erState = await solanaWrite.pollForVrfCallback(gameId)

    // 7. Fetch hole cards for each player (from ER, retry 3x on sentinel 255)
    for each player: solanaWrite.getPlayerHand(gameId, seatIndex, fromEr=true)

    // 8. Game loop (max 200 iterations)
    while erState.phase != "showdown" && activePlayers > 1:
        currentPlayer = erState.currentPlayer

        // Get LLM decision
        action = await llm.getAction(player.template, state, currentIdx)

        // Submit action to ER
        await solanaWrite.playerAction(gameId, actionCode, raiseAmount)

        // Broadcast to spectators via WebSocket
        wsFeed.broadcastToGame(gameId, stateUpdate)

        // Sync local state with ER state
        erState = await solanaWrite.getGameState(gameId, fromEr=true)

    // 9. Run showdown on ER (passes PlayerHands via remainingAccounts)
    await solanaWrite.showdownTest(gameId, players.length)

    // 10. Commit game back to L1
    await solanaWrite.commitGame(gameId)
    await solanaWrite.waitForBaseLayerSettle(gameId)  // poll up to 120s

    // 11. Return result, broadcast game_end
    return { winnerIndex, pot }
```

### 4.4 Arena Mode State Machine

```
idle
  ↓
betting (60s)
  ├─ Broadcast: arena_betting_open, arena_betting_countdown (1s), arena_pool_update
  ↓
Gate check: ≥2 agents with bets? (if requireBets=true)
  ├─ FAIL → cancel/refund pool → restart immediately (no cooldown)
  └─ PASS (or requireBets=false) →
      playing
        ├─ Lock pool on-chain
        ├─ Run orchestrator.runGame() (retry 2x on ER cloner errors, 15s backoff)
        ├─ Broadcast: game_state, game_action via arena channel
        ↓
      SUCCESS → settle pool, update virtual balances
        ├─ Broadcast: arena_game_complete
      FAILURE → cancel/refund pool
        ├─ Broadcast: arena_game_failed
      ↓
      cooldown (30s)
        ├─ Broadcast: arena_cooldown (1s countdown)
        ↓
      (loop back to betting)
```

**Arena Agents:** 6 fixed system agents with deterministic keypairs (SHA-256 of seed strings like `"arena-agent-shark"`).

| ID | Name | Template | Color | Starting Balance |
|----|------|----------|-------|------------------|
| 0 | Shark | Tight-aggressive | Blue | 100 |
| 1 | Maniac | Loose-aggressive | Red | 100 |
| 2 | Rock | Tight-passive | Gray | 100 |
| 3 | Fox | Balanced/tricky | Orange | 100 |
| 4 | Owl | GTO/analytical | Purple | 100 |
| 5 | Wolf | Positional-aggressive | Green | 100 |

Virtual balances: winner +10, losers -2 per round (min 50). Display-only, not real SOL.

**Arena Betting Flow:**

1. ArenaManager creates on-chain BettingPool via `createBettingPool(tableId, agentPubkeys)`
2. 60s window: users place bets on their chosen agent
3. User signs `place_bet` on-chain, sends `txSignature` to server via `POST /api/arena/bet`
4. Server verifies tx via `confirmTransaction(signature)`, tracks off-chain for real-time WS pool updates
5. Gate check: 2+ agents with bets? (skipped if `ARENA_REQUIRE_BETS=false`)
   - FAIL: `cancel_pool` → `refund_bet` per bettor → `close_pool` → restart
   - PASS: `lock_pool` → play game
6. Orchestrator runs full game (create → join → delegate → VRF → betting rounds → showdown → commit)
7. `settle_pool(winnerIndex)` on-chain → winners `claim_winnings` pro-rata
8. Update virtual balances, broadcast `arena_game_complete`
9. 30s cooldown → next round

### 4.5 LLM Gateway

Supports two providers via Vercel AI SDK (`ai` package):

| Provider | Model | SDK Package |
|----------|-------|-------------|
| `gemini` (default) | Gemini 2.5 Flash | `@ai-sdk/google` |
| `openrouter` | Meta Llama 3.3 70B Instruct | `@openrouter/ai-sdk-provider` |

**Decision Pipeline:**

```
Game State → buildUserMessage() → LLM Call → Zod Schema Validation → Action
                                      ↓
                              GameActionSchema {
                                type: fold|check|call|raise|all_in
                                amount?: number (in BB for raises)
                              }
                                      ↓
                              Convert BB → lamports: amount * bigBlind
                                      ↓
                              ACTION_MAP: fold=0, check=1, call=2, raise=3, all_in=4
                                      ↓
                              solanaClient.playerAction(gameId, code, lamports)
```

**Hand Strength Evaluation:** Before sending to the LLM, each player's hole cards are evaluated with a percentile-based hand strength calculator (`lib/hand-evaluator.ts`). The tier (Premium/Strong/Good/Playable/Weak) and percentile are included in the prompt to help the LLM calibrate its decisions.

**Prompt context includes:** game phase, pot size (in BB), blinds, hole cards + hand strength tier + percentile, cost to call, pot odds, opponent positions and bet sizes, last action, available actions with amounts.

**Resilience:** 3 retries per decision, 30s timeout, fallback to check (if free) or call (if facing bet). Configurable rate limiting (default: 6s between calls = 10 requests/minute).

### 4.6 Agent Templates

6 templates defined in `lib/templates.ts`, each with a detailed system prompt:

| ID | Name | Style | Strategy |
|----|------|-------|----------|
| 0 | Shark | Tight-aggressive | Top 55% hands, disciplined c-betting |
| 1 | Maniac | Loose-aggressive | 85% open range, constant pressure, 45% bluff rate |
| 2 | Rock | Tight-passive | Top 40% hands, minimal bluffing (15%) |
| 3 | Fox | Balanced/tricky | 65% range, check-raise heavy, exploitative |
| 4 | Owl | GTO/analytical | Math-based decisions, balanced frequencies |
| 5 | Wolf | Positional-aggressive | Relentless aggression, position-aware |

Each template includes a shared `POKER_BASICS` preamble covering hand rankings, range guidelines, critical rules, BB notation, and card format. Game state prompts are dynamically adapted for heads-up vs multi-player.

### 4.7 Matchmaker (Classic Mode)

```
Queue flow:
1. Player calls POST /api/queue/join with pubkey, displayName, template, wagerTier
2. Matchmaker groups by wager tier
3. When queue reaches 6 agents → creates table (UUID)
4. Emits "tableFull" event → starts betting window
5. Betting window: 60 seconds, countdown broadcast every 5 seconds
6. After 60s → emits "bettingLocked" → game-lifecycle plugin starts game
7. Stale queues cleaned up after 5 minutes (emits "queueTimeout")
```

### 4.8 AutoQueue (Classic Mode)

Automatically pairs agents for continuous gameplay:

- Every `AUTO_MATCH_INTERVAL_MS` (default 10s): check for in-progress games, fetch all agents, shuffle and pick 2, queue at lowest wager tier
- 30s cooldown between games
- Disabled via `AUTO_MATCH_ENABLED=false`

### 4.9 Data Storage

**No database.** All persistent data lives on-chain:

- **Agent stats** → AgentAccount on Solana L1
- **Game history** → GameState accounts (phase=Complete) on Solana L1
- **Leaderboard** → Derived from agent stats via `getProgramAccounts` (GPA)

The `OnChainReader` (`solana-read` plugin) uses in-memory caching with TTLs:

- Agent data: 10s TTL
- GPA queries (all agents, game history): 30s TTL
- Stats: 30s TTL (`activeGames` updated live from GameTracker)

---

## 5. REST API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check → `{ status: "ok" }` |
| GET | `/api/agents` | Paginated agent list (offset, limit) |
| GET | `/api/agents/:pubkey` | Single agent details + vault balance |
| GET | `/api/games/:gameId` | Active game state (from orchestrator) |
| GET | `/api/games/agent/:pubkey` | Completed game history for agent |
| GET | `/api/tables` | All active tables |
| GET | `/api/tables/:tableId` | Single table details |
| POST | `/api/tables/:tableId/bet` | Place spectator bet (classic mode) |
| GET | `/api/tables/:tableId/pool` | Betting pool totals |
| POST | `/api/queue/join` | Join matchmaking queue |
| GET | `/api/leaderboard` | Agents ranked by wins |
| GET | `/api/stats` | Global stats (games, agents, volume) |
| GET | `/api/arena/status` | Current arena state, phase, timers |
| GET | `/api/arena/agents` | Arena agents with virtual balances |
| GET | `/api/arena/pool` | Current arena betting pool totals |
| POST | `/api/arena/bet` | Place arena bet (with txSignature verification) |
| WS | `/ws` | WebSocket feed for live game updates |

---

## 6. WebSocket Protocol

Connect to `ws://host:port/ws`. Subscribe to games, tables, or channels:

```json
// Subscribe to arena
{ "type": "subscribe", "channel": "arena" }

// Subscribe to specific game/table
{ "type": "subscribe", "gameId": "123", "tableId": "abc" }

// Unsubscribe
{ "type": "unsubscribe", "gameId": "123" }

// Server acknowledges
{ "type": "subscribe_ack", ... }
```

**Game Lifecycle Messages:**

| Type | Trigger | Data |
|------|---------|------|
| `game_start` | Game begins | Full GameStateSnapshot |
| `game_state` | State sync (phase change) | Full GameStateSnapshot |
| `game_action` | Player takes action | GameStateSnapshot + action details |
| `game_end` | Game settled | Final GameStateSnapshot |

**Classic Mode Messages:**

| Type | Trigger | Data |
|------|---------|------|
| `betting_countdown` | Every 5s during betting window | BettingWindowData |
| `betting_locked` | Betting window closes | BettingWindowData |
| `pool_update` | Bet placed | Pool totals |
| `next_game_countdown` | AutoQueue cooldown | Seconds remaining |
| `table_update` | Table status change | Table info |
| `queue_timeout` | Queue cleaned up | Refunded players |

**Arena Mode Messages:**

| Type | Trigger | Data |
|------|---------|------|
| `arena_state_change` | Phase transition | New arena state |
| `arena_betting_open` | New round starts | Agents, countdown |
| `arena_betting_countdown` | Timer tick (1s) | Seconds remaining |
| `arena_betting_locked` | Betting closed | Pool snapshot |
| `arena_pool_update` | Pool amounts change | Per-agent breakdown |
| `arena_gate_failed` | Insufficient bets | Refund info |
| `arena_game_complete` | Winner determined | Winner + virtual balances |
| `arena_game_failed` | Game error | Error details |
| `arena_cooldown` | Cooldown timer tick | Seconds remaining |
| `arena_error` | System error | Error message |

---

## 7. Frontend

### 7.1 Tech Stack

- **Next.js 16** (App Router) with React 19, TypeScript 5
- **Tailwind CSS v4** — neobrutalist design (0px border-radius, 3-4px borders, offset shadows)
- **Motion** (motion.dev / Framer Motion) with LazyMotion for card/chip animations
- **React Query** (TanStack) for server state + WebSocket real-time updates
- **@solana/wallet-adapter** for wallet connection
- **Codama-generated clients** (`packages/program-clients/`) for type-safe on-chain interaction

### 7.2 Pages

| Path | Description |
|------|-------------|
| `/` | Landing page — LiveArena spectating hub |
| `/leaderboard` | Agent rankings by wins |
| `/agents` | Agent management (create, browse, queue) |
| `/agents/[pubkey]` | Agent detail view (stats, game history) |
| `/tables` | Active tables with tier filtering |
| `/tables/[tableId]` | Spectate + bet on a specific table |
| `/demo` | Interactive UI testing |

### 7.3 Key Components

**LiveArena** — Phase-based rendering: Betting (3x2 agent grid, countdown, bet panel) → Playing (PokerTable + ActionFeed + BettingPool sidebar) → Cooldown (winner banner, balance grid, next round countdown) → Idle.

**PokerTable** — 16:10 aspect ratio with green felt background, 2-6 player seats with absolute positioning, community cards center, pot display, street label, blind info, connection status.

**PlayerSeat** — Template-based emoji avatars, glowing border on current player (template color), gold pulse animation for winner, fold grayscale overlay, all-in red pulse badge, action popups with float-up animation.

**PlayingCard** — Card encoding (rank = code % 13, suit = floor(code / 13)), face-up/face-down rendering, deal animation with staggered timing.

**BettingPanel** — Agent selector, amount input, countdown progress bar, odds calculation, disabled without wallet connection. Phases: waiting → betting → locked → results.

### 7.4 Custom Hooks

| Hook | Description |
|------|-------------|
| `useArenaWebSocket()` | Arena channel subscription, auto-reconnect, initial state fetch via REST |
| `useGameWebSocket()` | Per-table subscription, returns game state + actions + betting data |
| `useStats()` | React Query wrapper for `/api/stats` |
| `useTables()` | React Query wrapper for `/api/tables` |
| `useAgents()` | React Query wrapper for `/api/agents` |
| `useLeaderboard()` | React Query wrapper for `/api/leaderboard` |
| `useAgentProgram()` | PDA derivation + transaction building for create/fund/withdraw |

### 7.5 Type System

**Core types** (`lib/types.ts`): `GameStateSnapshot`, `PlayerSnapshot`, `GameAction`, `TableInfo`, `AgentData`, `BettingPool`, `GameResult`.

**Arena types** (`lib/arena-types.ts`): `ArenaAgentConfig` (virtualBalance, color, personality), `ArenaState` ("idle" | "betting" | "playing" | "cooldown" | "refunding"), `ArenaPoolData` (totalPool + per-agent breakdown).

**Adapter layer** (`lib/adapters.ts`): `adaptWsMessage()` converts backend WS messages to frontend types. `adaptGameState()` maps phase names and converts lamports to SOL (`lamports / 1_000_000_000`).

---

## 8. Data Flow — Complete Game Lifecycle

```
Phase 1: TABLE SETUP
──────────────────────────────────────────────────
  Agent owner → create_agent(template, name)     [L1 tx]
  Agent owner → fund_agent(amount)               [L1 tx]
  AutoQueue   → polls for agents                 [API call, every 10s]
  AutoQueue   → matchmaker.joinQueue(agent)      [internal]
  Matchmaker  → creates table when queue fills   [internal, UUID]

Phase 2: BETTING WINDOW (60 seconds)
──────────────────────────────────────────────────
  Spectator   → POST /api/tables/:id/bet         [API call]
  WS Feed     → betting_countdown every 5s       [WebSocket]
  Timer       → 60s countdown
  WS Feed     → betting_locked                   [WebSocket]

Phase 3: GAME SETUP ON CHAIN
──────────────────────────────────────────────────
  Orchestrator → createGame(gameId, tableId)      [L1 tx + inline CPI: permission + delegate for GameState]
  Orchestrator → joinGame(gameId, seat, pubkey)   [L1 tx × N players, each inits PlayerHand + permission + delegate]
  Orchestrator → startGame (delegate to ER)       [L1 tx — GameState delegation only]
  Orchestrator → waitForErAccount                 [ER polling]

Phase 4: GAME PLAY (inside PER)
──────────────────────────────────────────────────
  Orchestrator → requestShuffle(gameId, N)        [ER tx + VRF CPI, hands via remaining_accounts]
  VRF oracle   → callback: shuffle + deal         [ER tx]
  Orchestrator → fetch hole cards from ER         [ER reads]

  LOOP (until showdown or single player remains):
    Orchestrator → getGameState from ER           [ER read]
    Orchestrator → LLM.getAction(template, state) [HTTP to LLM API]
    LLM          → returns action (fold/check/...) [HTTP response]
    Orchestrator → playerAction on ER              [ER tx]
    Orchestrator → broadcast state via WebSocket   [WS broadcast]

Phase 5: SHOWDOWN
──────────────────────────────────────────────────
  Orchestrator → showdownTest(gameId, N)          [ER tx, hands via remaining_accounts]
              → winner determined
  Orchestrator → broadcast game_end               [WebSocket]

Phase 6: SETTLEMENT
──────────────────────────────────────────────────
  Orchestrator → commitGame()                     [ER tx — undelegates to L1]
  Orchestrator → waitForBaseLayerSettle           [L1 polling]
  Lifecycle    → updateAgentStats for each player [L1 tx × N]
  Lifecycle    → autoQueue.notifyGameEnded()      [internal]
  AutoQueue    → cooldown, then next game         [internal]
```

---

## 9. Cost Estimates (Per Game)

| Item | Cost |
|------|------|
| LLM calls (~20 calls/game) | ~$0.01 |
| Solana L1 txs (~15 txs) | ~$0.01 |
| PER txs (~60 txs) | ~$0.05 |
| VRF request | ~$0.01 |
| **Total platform cost** | **~$0.08** |

Revenue per game (0.1 SOL wager tier, 2 players):

| Source | Amount |
|--------|--------|
| Agent rake (5% of 0.2 SOL pot) | 0.01 SOL |
| Spectator rake (5% of pool) | Variable |

---

## 10. Tech Stack Summary

| Layer | Technology |
|-------|------------|
| Blockchain | Solana (devnet, targeting mainnet) |
| Smart contracts | Anchor (Rust) — 4 programs |
| Game execution | MagicBlock Private Ephemeral Rollup (TEE) |
| Randomness | MagicBlock VRF |
| Game server | Fastify 5 / TypeScript (plugin architecture) |
| Schema validation | TypeBox (routes) + Zod (env, LLM output) |
| LLM | Gemini 2.5 Flash (default) / Llama 3.3 70B (OpenRouter) |
| AI SDK | Vercel AI SDK (`ai` package) |
| Frontend | Next.js 16 + Tailwind CSS v4 + Motion |
| Wallet | @solana/wallet-adapter |
| Real-time feed | WebSocket (@fastify/websocket) |
| Data storage | On-chain (no database) |
| Code generation | Codama (IDL → TypeScript clients) |
| Containerization | Docker (multi-stage pnpm build) |
| Testing | Anchor integration tests + Vitest |
| Monorepo | pnpm workspaces + Turborepo |

---

## 11. Program IDs (Devnet)

| Program | ID |
|---------|-----|
| agent-poker-agent | `6xJviS1Mz3rArD3JciQ55u7K1xDqtYr1AGvSeWvW1dti` |
| agent-poker-betting | `HR2iEFkkt893fFtatyp3hivAzC8jznVpeoCAy5HBfQ4D` |
| agent-poker-escrow | `Ed684BPr262EGicZGayjLNB8ujMYct771bc8LMBV5CUf` |
| agent-poker-game | `4dnm62opQrwADRgKFoGHrpt8zCWkheTRrs3uVCAa3bRr` |

---

## 12. Planned Architecture Changes (Game Modes)

### Mode 2: Player vs Agent

**Orchestrator changes:** Distinguish AI vs human players. For human players, broadcast `your_turn` WS message and wait for input (30s timeout, auto-fold).

**New WS messages:** `your_turn` (server → specific player), `player_action` (player → server), `turn_timeout` (server → player).

**New plugin:** `PvAManager` — creates tables with AI host pre-seated, manages human turn timeouts, per-player state filtering (hide other players' cards).

**Escrow integration:** Human players buy-in via existing `join_table`. AI host needs funded on-chain agent account.

### Mode 3: Player vs Players

**Orchestrator changes:** All players are human. No LLM calls. Pure WS action collection with timeouts.

**New plugin:** `PvPManager` — table creation by any user, lobby browsing, disconnect/reconnect handling (60s grace period), parallel game runner.

**On-chain changes:** None. Existing programs handle PvP identically from the chain's perspective.

### Multi-Mode Coexistence

```typescript
// Future: all modes run simultaneously
await fastify.register(arenaManagerPlugin);   // /api/arena/*
await fastify.register(pvaManagerPlugin);     // /api/pva/*
await fastify.register(pvpManagerPlugin);     // /api/pvp/*
```
