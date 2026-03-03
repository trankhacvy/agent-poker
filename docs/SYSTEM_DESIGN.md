# AgentPoker — System Design (MVP)

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SOLANA L1 (Devnet)                           │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │
│  │ Agent Program │  │ Wager Escrow │  │ Spectator Betting Program │ │
│  │              │  │   Program    │  │                           │ │
│  │ - Create     │  │ - Deposit    │  │ - Create pool             │ │
│  │ - Configure  │  │ - Lock       │  │ - Place bet               │ │
│  │ - Fund       │  │ - Settle     │  │ - Settle                  │ │
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
              │  │                        │  │
              │  │  - Game state (private) │  │
              │  │  - Player hands (hidden)│  │
              │  │  - Betting rounds       │  │
              │  │  - Showdown logic       │  │
              │  └────────────────────────┘  │
              │                              │
              │  ┌────────────────────────┐  │
              │  │    MagicBlock VRF      │  │
              │  │  - Deck shuffle        │  │
              │  │  - Card dealing        │  │
              │  └────────────────────────┘  │
              └──────────────┬──────────────┘
                             │
                             │ game events
                             │
              ┌──────────────┴──────────────┐
              │     Game Server (Fastify)    │
              │     Plugin Architecture     │
              │                              │
              │  ┌────────────────────────┐  │
              │  │  Orchestrator Plugin   │  │
              │  │  - Read game state     │  │
              │  │  - Feed to LLM         │  │
              │  │  - Submit action tx    │  │
              │  └────────────────────────┘  │
              │                              │
              │  ┌────────────────────────┐  │
              │  │  LLM Plugin           │  │
              │  │  - Template → prompt   │  │
              │  │  - Gemini 2.5 Flash / │  │
              │  │    Llama 3.3 70B      │  │
              │  └────────────────────────┘  │
              │                              │
              │  ┌────────────────────────┐  │
              │  │  WS Feed Plugin       │  │
              │  │  - Public game state   │  │
              │  │  - Betting updates     │  │
              │  └────────────────────────┘  │
              └──────────────────────────────┘
                             │
                             │ websocket
                             │
              ┌──────────────┴──────────────┐
              │     Frontend (Next.js)       │
              │                              │
              │  - Wallet connect            │
              │  - Agent creation/management │
              │  - Live game spectator view  │
              │  - Spectator betting UI      │
              │  - Leaderboards              │
              └──────────────────────────────┘
```

---

## 2. On-Chain Programs (Solana / Anchor)

### 2.1 Agent Program

Manages agent identities and configuration on L1.

```
Account: AgentAccount (PDA: [b"agent", owner_pubkey])
├── owner: Pubkey              // wallet that owns this agent
├── template: u8               // 0=Shark, 1=Maniac, 2=Rock, 3=Fox
├── display_name: String       // max 20 chars
├── wallet: Pubkey             // agent's SOL wallet (PDA)
├── total_games: u64
├── total_wins: u64
├── total_earnings: i64        // net profit/loss in lamports
├── created_at: i64
└── bump: u8

Instructions:
├── create_agent(template, display_name)
│   → Creates AgentAccount + agent wallet PDA
│   → One agent per owner wallet (MVP)
│
├── fund_agent(amount)
│   → Transfer SOL from owner → agent wallet PDA
│
├── update_stats(games_delta, wins_delta, earnings_delta)
│   → Called by game authority after each game
│   → Updates total_games, total_wins, total_earnings
│
└── withdraw(amount)
    → Transfer SOL from agent wallet PDA → owner
    → Only owner can call
```

### 2.2 Wager Escrow Program

Handles table buy-ins and payouts.

```
Account: TableEscrow (PDA: [b"table", table_id])
├── table_id: u64
├── wager_tier: u64            // lamports per seat (e.g., 0.1 SOL)
├── players: [Pubkey; 6]       // agent pubkeys (0 = empty seat)
├── player_count: u8
├── status: enum { Open, Full, InProgress, Settled }
├── winner: Option<Pubkey>
├── created_at: i64
└── bump: u8

Instructions:
├── initialize_treasury()
│   → Creates platform treasury PDA
│
├── create_table(wager_tier)
│   → Platform authority creates table
│   → Sets wager amount
│
├── join_table(agent_pubkey)
│   → Transfer wager from agent wallet → escrow PDA
│   → Add to players array
│   → If player_count == 6 → status = Full
│
├── start_game()
│   → Transitions table to InProgress
│
├── settle_table(winner_pubkey)
│   → Only callable by game_authority (game server signer)
│   → Transfer (total_pot * 95%) → winner agent wallet
│   → Transfer (total_pot * 5%) → platform treasury
│   → status = Settled
│
└── refund_table()
    → If game cancelled (timeout, not enough players)
    → Return wagers to all agent wallets
```

### 2.3 Spectator Betting Program

```
Account: BettingPool (PDA: [b"bet_pool", table_id])
├── table_id: u64
├── total_pool: u64            // total SOL bet by spectators
├── status: enum { Open, Locked, Settled }
├── winner: Option<Pubkey>     // winning agent
└── bump: u8

Account: BetAccount (PDA: [b"bet", pool, bettor])
├── pool: Pubkey
├── bettor: Pubkey
├── agent: Pubkey
├── amount: u64
└── bump: u8

Instructions:
├── create_pool(table_id)
│   → Created when table is created
│
├── place_bet(agent_pubkey, amount)
│   → Transfer SOL from bettor → pool PDA
│   → Only while status == Open
│
├── lock_pool()
│   → Locks betting when game starts
│
├── settle_pool(winner_pubkey)
│   → Game authority calls after game ends
│   → Calculate each winning bettor's share (pro-rata)
│   → 95% of pool → winning bettors
│   → 5% → platform treasury
│
└── claim_winnings()
    → Bettor calls to withdraw their share
```

---

## 3. Poker Game Program (Runs on MagicBlock PER)

This is the core game logic. It runs inside a **Private Ephemeral Rollup** (TEE) so
player hands remain hidden until showdown. The program is annotated with `#[ephemeral]`.

### 3.1 State Accounts

```
Account: GameState (PDA: [b"poker_game", game_id (u64 LE)])  — DELEGATED TO PER
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
├── winner_index: u8
├── last_action_at: i64
└── bump: u8

Account: PlayerHand (PDA: [b"player_hand", game_id (u64 LE), seat_index])  — PERMISSIONED
├── game_id: u64
├── seat_index: u8
├── hand: [u8; 2]             // private hole cards
└── bump: u8
// Permission: only the game authority can read during play
```

### 3.2 Instructions

```
create_game(game_id, table_id, wager_tier)
    → Create GameState + 6 PlayerHand accounts
    → Set phase = Waiting

join_game(game_id, seat_index, player_pubkey)
    → Register player at seat
    → Delegate PlayerHand to PER with permissions

delegate_pda(pda_type)
    → Delegate empty PlayerHand PDAs to PER for unused seats

start_game(game_id)
    → Delegate GameState to PER
    → Ready for VRF shuffle

request_shuffle(game_id)
    → CPI to MagicBlock VRF program
    → On callback: Fisher-Yates shuffle, deal 2 cards per player
    → Advance phase: Waiting → Preflop
    → Post blinds automatically

player_action(action, raise_amount)
    → Validate it's this player's turn
    → action: 0=fold, 1=check, 2=call, 3=raise, 4=all_in
    → Apply action, update pot/bets/status
    → Advance to next active player
    → If round complete → advance phase:
        Preflop → Flop (reveal 3 community cards)
        Flop → Turn (reveal 1 community card)
        Turn → River (reveal 1 community card)
        River → Showdown

showdown_test()
    → Evaluate all remaining players' hands + community cards
    → Determine winner (standard poker hand ranking)
    → Record winner_index in GameState

commit_game()
    → Undelegate GameState from PER back to L1
    → Phase = Complete after settling on base layer
```

### 3.3 Privacy Model (MagicBlock PER)

```
Delegation flow:

1. Game server creates game + player hand accounts on L1
2. Players join → each PlayerHand delegated to PER during join_game
3. Empty seat PlayerHands delegated via delegate_pda
4. GameState delegated to PER via start_game
5. PER permissions:
   - GameState: readable by game server authority
   - PlayerHand[i]: readable by game authority (for LLM input)
6. Game plays out inside PER
7. On commit_game: GameState undelegated back to L1
8. Settlement + stats updates execute on L1
```

### 3.4 Card Dealing (MagicBlock VRF)

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

---

## 4. Game Server (Off-Chain)

The game server is the orchestrator. It does NOT make game decisions — it feeds state
to LLMs and submits their decisions as transactions.

### 4.1 Plugin Architecture

The server uses **Fastify** with a plugin-based architecture. Each service is a
`fastify-plugin` that decorates the Fastify instance with its class. Plugins are
registered in dependency order and accessible via `fastify.<name>`.

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
│   ├── game-lifecycle.ts       # Event wiring (bettingLocked, queueTimeout)
│   └── index.ts                # Registers all plugins in dependency order
├── routes/
│   ├── agents.ts               # GET /api/agents, GET /api/agents/:pubkey
│   ├── games.ts                # GET /api/games/:gameId, GET /api/games/agent/:pubkey
│   ├── leaderboard.ts          # GET /api/leaderboard
│   ├── queue.ts                # POST /api/queue/join
│   ├── tables.ts               # GET /api/tables, GET /api/tables/:tableId, betting
│   ├── stats.ts                # GET /api/stats
│   └── index.ts                # Barrel, all under /api prefix
├── schemas/
│   ├── agent.ts                # AgentSchema (TypeBox)
│   ├── game.ts                 # GameHistory schemas
│   ├── table.ts                # Table/Player schemas
│   ├── pagination.ts           # PaginationQuery, PubkeyParams
│   ├── errors.ts               # ErrorResponse schema
│   └── index.ts                # Barrel
├── lib/
│   ├── hand-evaluator.ts       # evaluateHand() for LLM context
│   └── templates.ts            # 4 agent personality templates
├── types.ts                    # Core TS interfaces
├── app.ts                      # buildApp() factory (testable)
└── server.ts                   # Slim: import dotenv, buildApp(), listen
```

#### Plugin Registration Order

```
1. @fastify/cors
2. @fastify/websocket
3. env             (Zod-validates process.env)
4. error-handler   (centralized error formatting)
5. game-tracker    (active game counter)
6. solana-read     (depends on: env)
7. solana-write    (depends on: env)
8. llm             (depends on: env)
9. websocket-feed  (registers /ws route)
10. matchmaker     (depends on: websocket-feed)
11. orchestrator   (depends on: solana-write, llm, websocket-feed)
12. auto-queue     (depends on: matchmaker, solana-read, env)
13. game-lifecycle (depends on: all of the above)
```

#### Fastify Decorators

```typescript
declare module "fastify" {
  interface FastifyInstance {
    env: Env;                   // Zod-validated environment
    solanaRead: OnChainReader;  // Read-only on-chain queries (@solana/kit v2)
    solanaWrite: SolanaClient;  // On-chain transactions (@solana/web3.js v1 + Anchor)
    llm: LlmGateway;           // LLM provider abstraction
    wsFeed: WsFeed;             // WebSocket broadcast
    matchmaker: Matchmaker;     // Queue + betting windows
    orchestrator: Orchestrator; // Game execution loop
    autoQueue: AutoQueue;       // Automatic agent pairing
    gameTracker: GameTracker;   // Active game count
  }
}
```

### 4.2 Environment Configuration

Validated at startup via Zod. Server fails fast on invalid config.

```
PORT                          # Server port (default: 3001)
LLM_PROVIDER                  # "gemini" or "openrouter" (default: "gemini")
GOOGLE_GENERATIVE_AI_API_KEY  # Gemini API key
OPENROUTER_API_KEY            # OpenRouter API key
SOLANA_RPC_URL                # Solana RPC (default: devnet)
AUTHORITY_PRIVATE_KEY         # Base58 private key (for deployments)
AUTHORITY_KEYPAIR_PATH        # Path to JSON keypair file (for local dev)
EPHEMERAL_PROVIDER_ENDPOINT   # MagicBlock ER RPC endpoint
EPHEMERAL_WS_ENDPOINT         # MagicBlock ER WebSocket endpoint
AUTO_MATCH_INTERVAL_MS        # Auto-queue check interval (default: 10000)
AUTO_MATCH_ENABLED            # Enable auto-queue (default: "true")
```

At least one of `AUTHORITY_PRIVATE_KEY` or `AUTHORITY_KEYPAIR_PATH` must be set.

### 4.3 Turn Orchestrator Loop

```
async runGame(config: GameConfig):
    // 1. Create game on L1
    await solanaWrite.createGame(gameId, tableId, wagerTier)

    // 2. Join all players on L1 (delegates PlayerHand PDAs)
    for player in players:
        await solanaWrite.joinGame(gameId, player.seatIndex, player.pubkey)

    // 3. Delegate empty hand PDAs for unused seats
    await solanaWrite.delegateEmptyHands(gameId, players.length)

    // 4. Start game (delegates GameState to ER)
    await solanaWrite.startGame(gameId)

    // 5. Wait for GameState to appear on ER
    await solanaWrite.waitForErAccount(gamePda)

    // 6. Request VRF shuffle on ER
    await solanaWrite.requestShuffle(gameId)

    // 7. Poll for VRF callback (phase changes from Waiting)
    erState = await solanaWrite.pollForVrfCallback(gameId)

    // 8. Fetch hole cards for each player (from ER)
    for each player: solanaWrite.getPlayerHand(gameId, seatIndex, fromEr=true)

    // 9. Game loop
    while erState.phase != "showdown" && erState.phase != "settled":
        currentPlayer = erState.currentPlayer

        // Get LLM decision
        action = await llm.getAction(player.template, state, currentIdx)

        // Submit action to ER
        await solanaWrite.playerAction(gameId, actionCode, raiseAmount)

        // Sync local state with ER state
        erState = await solanaWrite.getGameState(gameId, fromEr=true)

        // Broadcast to spectators via WebSocket
        wsFeed.broadcastToGame(gameId, stateUpdate)

    // 10. Run showdown on ER
    await solanaWrite.showdownTest(gameId)

    // 11. Commit game back to L1
    await solanaWrite.commitGame(gameId)
    await solanaWrite.waitForBaseLayerSettle(gameId)

    // 12. Update agent stats on L1
    for each player:
        await solanaWrite.updateAgentStats(pubkey, games, wins, earnings)
```

### 4.4 LLM Gateway

Supports two providers, configurable via `LLM_PROVIDER` env var:

| Provider    | Model                        | Use Case          |
|-------------|------------------------------|--------------------|
| `gemini`    | Gemini 2.5 Flash             | Default, fast      |
| `openrouter`| Meta Llama 3.3 70B Instruct  | Alternative        |

Uses [Vercel AI SDK](https://sdk.vercel.ai/) (`ai` package) for structured output.

```typescript
const result = await generateText({
    model: getModel(),          // Gemini or OpenRouter
    system: template.systemPrompt,
    prompt: buildUserMessage(gameState, playerIndex),
    output: Output.object({ schema: GameActionSchema }),
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(20000),
});
```

The LLM output is validated with Zod:

```typescript
const GameActionSchema = z.object({
    type: z.enum(["fold", "check", "call", "raise", "all_in"]),
    amount: z.number().optional(), // BB for raises, converted to lamports
});
```

**Hand Strength Evaluation:** Before sending to the LLM, each player's hole cards
are evaluated with a percentile-based hand strength calculator (`lib/hand-evaluator.ts`).
The tier (Premium/Strong/Good/Playable/Weak) and percentile are included in the prompt
to help the LLM calibrate its decisions.

**Fallback:** If all 3 LLM attempts fail, the action falls back to check (if free)
or call.

**Rate Limiting:** Configurable minimum delay between LLM calls (default: 6 seconds
= 10 requests/minute).

### 4.5 Agent Templates (System Prompts)

Templates are defined in `lib/templates.ts` as an array of objects:

| ID | Name   | Style              | Description                                    |
|----|--------|--------------------|------------------------------------------------|
| 0  | Shark  | tight-aggressive   | Selective hand play, aggressive betting         |
| 1  | Maniac | loose-aggressive   | Plays 85% of hands, frequent bluffs            |
| 2  | Rock   | tight-passive      | Patient, calls frequently, minimal bluffing    |
| 3  | Fox    | balanced/tricky    | Check-raises, semi-bluffs, deceptive plays     |

Each template includes a shared `POKER_BASICS` preamble covering:
- Hand rankings
- Heads-up range guidelines
- Critical rules (never fold when free, call standard raises with playable hands)
- BB notation and card format

The game state prompt sent to the LLM is dynamically adapted:
- Heads-up games get "This is HEADS-UP (1v1). Play wide ranges."
- Multi-player games get "This is a N-player game. Tighten your ranges."

### 4.6 Matchmaker

The matchmaker manages player queues, table creation, and betting windows.

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

Constants:
- `AGENTS_PER_GAME = 6` (table size, but AutoQueue picks 2 for heads-up)
- `BETTING_WINDOW_SECONDS = 60`
- `BETTING_COUNTDOWN_INTERVAL_SECONDS = 5`
- `QUEUE_TIMEOUT_MS = 300000` (5 minutes)

### 4.7 AutoQueue

Automatically pairs agents for continuous gameplay during development/demo:

```
Every AUTO_MATCH_INTERVAL_MS (default 10 seconds):
1. Check if any table is in_progress or full → skip
2. If a game just ended → enforce 15 second cooldown (for spectators)
3. Fetch all registered agents from chain
4. Shuffle and pick AGENTS_PER_GAME (2) agents
5. Queue them into the matchmaker at LOWEST_WAGER_TIER (0.1 SOL)
```

Can be disabled via `AUTO_MATCH_ENABLED=false`.

### 4.8 Data Storage

**No database.** All persistent data lives on-chain:

- **Agent stats** → AgentAccount on Solana L1
- **Game history** → GameState accounts (phase = Complete) on Solana L1
- **Leaderboard** → Derived from agent stats via getProgramAccounts (GPA)

The `OnChainReader` (solana-read plugin) uses in-memory caching with TTLs:
- Agent data: 10 second TTL
- GPA queries (all agents, game history): 30 second TTL
- Stats: 30 second TTL (activeGames updated live from GameTracker)

### 4.9 API Endpoints

| Method | Path                          | Description                              |
|--------|-------------------------------|------------------------------------------|
| GET    | `/health`                     | Health check → `{ status: "ok" }`        |
| GET    | `/api/agents`                 | List all agents (pagination: offset, limit) |
| GET    | `/api/agents/:pubkey`         | Single agent details + vault balance     |
| GET    | `/api/games/:gameId`          | Active game state (from orchestrator)    |
| GET    | `/api/games/agent/:pubkey`    | Completed game history for agent         |
| GET    | `/api/tables`                 | All active tables                        |
| GET    | `/api/tables/:tableId`        | Single table details                     |
| POST   | `/api/tables/:tableId/bet`    | Place spectator bet (wallet, agent, amount) |
| GET    | `/api/tables/:tableId/pool`   | Betting pool totals                      |
| POST   | `/api/queue/join`             | Join matchmaking queue                   |
| GET    | `/api/leaderboard`            | Agents ranked by wins                    |
| GET    | `/api/stats`                  | Global stats (games, agents, volume)     |
| WS     | `/ws`                         | WebSocket feed for live game updates     |

### 4.10 WebSocket Messages

Connect to `ws://host:port/ws`. Subscribe to games/tables:

```json
// Subscribe
{ "type": "subscribe", "gameId": "123", "tableId": "abc" }
// → Ack: { "type": "subscribe_ack", ... }

// Unsubscribe
{ "type": "unsubscribe", "gameId": "123" }
```

Server broadcasts these message types:

| Type                  | Trigger                          | Data                       |
|-----------------------|----------------------------------|----------------------------|
| `game_start`          | Game begins                      | Full GameStateSnapshot     |
| `game_state`          | State sync (phase change, etc.)  | Full GameStateSnapshot     |
| `game_action`         | Player takes action              | GameStateSnapshot + action |
| `game_end`            | Game settled                     | Final GameStateSnapshot    |
| `betting_countdown`   | Every 5s during betting window   | BettingWindowData          |
| `betting_locked`      | Betting window closes            | BettingWindowData          |
| `pool_update`         | Bet placed                       | Pool totals                |
| `queue_timeout`       | Queue cleaned up                 | Refunded players           |
| `next_game_countdown` | AutoQueue cooldown               | Seconds remaining          |

---

## 5. Frontend

### 5.1 Tech Stack

- **Next.js 15** (App Router)
- **Tailwind CSS** for styling
- **@solana/wallet-adapter** for wallet connection
- **Native WebSocket** client for live game feed
- **Motion** (motion.dev) for card/chip animations

### 5.2 Pages

```
/                           → Landing page (live arena, stats, FAQ)
/agents                     → Browse all registered agents
/agents/[pubkey]            → Agent detail view (stats, game history)
/tables                     → Browse open/live tables
/tables/[tableId]           → Live spectator view of a game
/leaderboard                → Top agents by winnings
```

### 5.3 Spectator View (Key Screen)

```
┌──────────────────────────────────────────────────┐
│                SPECTATOR VIEW                     │
│                                                   │
│   Player 1 (Shark)     Player 2 (Fox)            │
│   [$45] Active          [$32] Folded              │
│   [??][??]              [--][--]                  │
│                                                   │
│           ┌─────────────────┐                     │
│           │  [K♠] [9♥] [3♦] │  Pot: $28          │
│           │    FLOP          │                     │
│           └─────────────────┘                     │
│                                                   │
│   Player 3 (Maniac)    Player 4 (Rock)           │
│   [$22] THINKING...     [$13] All-In              │
│   [??][??]              [??][??]                  │
│                                                   │
│  ┌─ SPECTATOR BETS ─────────────────────────┐    │
│  │ Your bet: $5 on Player 1 (Shark)         │    │
│  │ Pool: $142 total  │  Your potential: $28  │    │
│  └───────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

---

## 6. Data Flow — Complete Game Lifecycle

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
  Orchestrator → createGame(gameId, tableId)      [L1 tx]
  Orchestrator → joinGame(gameId, seat, pubkey)   [L1 tx × N players]
  Orchestrator → delegateEmptyHands              [L1 tx × (6 - N)]
  Orchestrator → startGame (delegate to ER)       [L1 tx]
  Orchestrator → waitForErAccount                 [ER polling]

Phase 4: GAME PLAY (inside PER)
──────────────────────────────────────────────────
  Orchestrator → requestShuffle                   [ER tx + VRF CPI]
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
  Orchestrator → showdownTest()                   [ER tx]
              → winner determined
  Orchestrator → broadcast game_end               [WebSocket]

Phase 6: SETTLEMENT
──────────────────────────────────────────────────
  Orchestrator → commitGame()                     [ER tx — undelegates to L1]
  Orchestrator → waitForBaseLayerSettle           [L1 polling]
  Lifecycle    → updateAgentStats for each player [L1 tx × N]
  Lifecycle    → autoQueue.notifyGameEnded()      [internal]
  AutoQueue    → 15s cooldown, then next game     [internal]
```

---

## 7. Cost Estimates (Per Game)

| Item                          | Cost       |
| ----------------------------- | ---------- |
| LLM calls (~20 calls/game)   | ~$0.01     |
| Solana L1 txs (~15 txs)      | ~$0.01     |
| PER txs (~60 txs)            | ~$0.05     |
| VRF request                  | ~$0.01     |
| **Total platform cost**      | **~$0.08** |

Revenue per game (0.1 SOL wager tier, 2 players):
| Source                           | Amount     |
| -------------------------------- | ---------- |
| Agent rake (5% of 0.2 SOL pot)  | 0.01 SOL   |
| Spectator rake (5% of pool)     | Variable   |

---

## 8. Tech Stack Summary

| Layer               | Technology                               |
| ------------------- | ---------------------------------------- |
| Blockchain          | Solana (devnet, targeting mainnet)       |
| Smart contracts     | Anchor (Rust)                            |
| Game execution      | MagicBlock Private Ephemeral Rollup      |
| Randomness          | MagicBlock VRF                           |
| Game server         | Fastify 5 / TypeScript (plugin architecture) |
| Schema validation   | TypeBox (routes) + Zod (env, LLM output) |
| LLM                 | Gemini 2.5 Flash (default) / Llama 3.3 70B (OpenRouter) |
| AI SDK              | Vercel AI SDK (`ai` package)             |
| Frontend            | Next.js 15 + Tailwind + Motion           |
| Wallet              | @solana/wallet-adapter                   |
| Real-time feed      | WebSocket (@fastify/websocket)           |
| Data storage        | On-chain (no database)                   |
| Containerization    | Docker (multi-stage pnpm build)          |
| Testing             | Vitest                                   |
| Monorepo            | pnpm workspaces + Turborepo              |

---

## 9. MVP Milestones

```
M1: On-chain programs ✅
    - Agent Program (create, fund, withdraw, update_stats)
    - Wager Escrow Program (create, join, start, settle, refund)
    - Spectator Betting Program (create, bet, lock, settle, claim)
    - Poker Game Program with MagicBlock delegation + VRF
    - Deploy to devnet

M2: Game server ✅
    - Plugin-based Fastify architecture
    - Turn orchestrator with full L1 ↔ ER flow
    - LLM gateway (Gemini + OpenRouter)
    - 4 agent templates with hand strength evaluation
    - Matchmaker with betting windows
    - AutoQueue for continuous play
    - WebSocket feed for live updates
    - REST API for agents, games, tables, stats

M3: Frontend ✅
    - Landing page with live arena
    - Agent browsing and creation
    - Live spectator view with animations
    - Leaderboard
    - Wallet connect integration

M4: Integration + polish (in progress)
    - End-to-end testing on devnet
    - Spectator betting UI integration
    - Fund/withdraw agent wallet UI
    - Load testing (concurrent games)
    - Mainnet deployment
```
