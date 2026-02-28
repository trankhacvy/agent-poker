# AgentPoker — System Design (MVP)

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SOLANA L1 (Mainnet)                         │
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
              │      (Off-chain)            │
              │                              │
              │  ┌────────────────────────┐  │
              │  │  Turn Orchestrator     │  │
              │  │  - Read game state     │  │
              │  │  - Feed to LLM         │  │
              │  │  - Submit action tx    │  │
              │  └────────────────────────┘  │
              │                              │
              │  ┌────────────────────────┐  │
              │  │  LLM Gateway          │  │
              │  │  - Template → prompt   │  │
              │  │  - Claude Haiku /      │  │
              │  │    GPT-4o-mini         │  │
              │  └────────────────────────┘  │
              │                              │
              │  ┌────────────────────────┐  │
              │  ┌────────────────────────┐  │
              │  │  WS Feed (@fastify/ws) │  │
              │  │  - Public game state   │  │
              │  │  - Agent reasoning     │  │
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
└── withdraw(amount)
    → Transfer SOL from agent wallet PDA → owner
    → Only owner can call
```

### 2.2 Wager Escrow Program

Handles table buy-ins and payouts.

```
Account: TableEscrow (PDA: [b"table", table_id])
├── table_id: u64
├── wager_tier: u64            // lamports per seat (e.g., 1 SOL)
├── players: [Pubkey; 6]       // agent pubkeys (0 = empty seat)
├── player_count: u8
├── status: enum { Open, Full, InProgress, Settled }
├── winner: Option<Pubkey>
├── created_at: i64
└── bump: u8

Instructions:
├── create_table(wager_tier)
│   → Platform authority creates table
│   → Sets wager amount
│
├── join_table(agent_pubkey)
│   → Transfer wager from agent wallet → escrow PDA
│   → Add to players array
│   → If player_count == 6 → status = Full, trigger game start
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
├── bets: Vec<Bet>             // max ~50 bets per pool (MVP)
├── status: enum { Open, Locked, Settled }
├── winner: Option<Pubkey>     // winning agent
└── bump: u8

Struct: Bet
├── bettor: Pubkey             // spectator wallet
├── agent: Pubkey              // agent they bet on
└── amount: u64                // lamports

Instructions:
├── create_pool(table_id)
│   → Created when table is created
│
├── place_bet(agent_pubkey, amount)
│   → Transfer SOL from bettor → pool PDA
│   → Only while status == Open
│   → Locks when game starts
│
├── settle_pool(winner_pubkey)
│   → Game authority calls after game ends
│   → Calculate each winning bettor's share (pro-rata)
│   → 95% of pool → winning bettors
│   → 5% → platform treasury
│   → Each winner can claim via separate tx
│
└── claim_winnings()
    → Bettor calls to withdraw their share
```

---

## 3. Poker Game Program (Runs on MagicBlock PER)

This is the core game logic. It runs inside a **Private Ephemeral Rollup** (TEE) so
player hands remain hidden until showdown.

### 3.1 State Accounts

```
Account: GameState (PDA: [b"game", table_id])  — DELEGATED TO PER
├── table_id: u64
├── phase: enum { Preflop, Flop, Turn, River, Showdown, Finished }
├── deck: [u8; 52]            // shuffled deck (PRIVATE — only TEE can read)
├── community_cards: [u8; 5]  // revealed progressively
├── pot: u64                   // current pot in lamports
├── current_bet: u64           // current bet to call
├── dealer_index: u8           // button position
├── active_player: u8          // whose turn (0-5)
├── round_actions: u8          // actions taken this round
├── players: [PlayerState; 6]
└── bump: u8

Struct: PlayerState
├── agent: Pubkey
├── chips: u64                 // starting chips = wager amount
├── hand: [u8; 2]             // PRIVATE — only visible to that agent's authorized key
├── current_round_bet: u64
├── status: enum { Active, Folded, AllIn, Eliminated }
└── last_action: enum { None, Fold, Check, Call, Raise(u64), AllIn }

Account: PlayerHand (PDA: [b"hand", table_id, player_index])  — PERMISSIONED
├── cards: [u8; 2]            // private hole cards
└── bump: u8
// Permission: only the agent's authorized signer can read this account
```

### 3.2 Instructions

```
initialize_game(table_id, players: [Pubkey; 6])
    → Create GameState, set phase = Preflop
    → Request VRF for deck shuffle
    → CPI to MagicBlock VRF program

vrf_callback(randomness: [u8; 32])
    → Shuffle deck using Fisher-Yates with VRF seed
    → Deal 2 cards to each player → write to PlayerHand accounts
    → Set permissions: each PlayerHand readable only by corresponding agent signer
    → Set active_player = left of dealer

player_action(player_index, action: PokerAction)
    → Validate it's this player's turn
    → Validate action is legal given game state
    → Apply action (fold/check/call/raise/all-in)
    → Update pot, current_bet, player chips
    → Advance to next active player
    → If round complete → advance phase:
        Preflop → Flop (reveal 3 community cards)
        Flop → Turn (reveal 1 community card)
        Turn → River (reveal 1 community card)
        River → Showdown

showdown()
    → Evaluate all remaining players' hands + community cards
    → Determine winner (standard poker hand ranking)
    → Update permissions: all PlayerHand accounts become public
    → Record winner in GameState
    → phase = Finished
    → Emit event for settlement

enum PokerAction {
    Fold,
    Check,
    Call,
    Raise(u64),
    AllIn,
}
```

### 3.3 Privacy Model (MagicBlock PER)

```
Delegation flow:

1. Table fills (6 players) on L1
2. Game server delegates GameState + 6 PlayerHand accounts to PER (TEE node)
3. PER creates permissions:
   - GameState: readable by game server (for public state broadcast)
   - PlayerHand[i]: readable ONLY by agent[i]'s authorized signer
4. Game plays out inside PER
5. On showdown: permissions updated, all hands become public
6. GameState undelegated back to L1
7. Settlement executes on L1
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

### 4.1 Components

```
game-server/
├── src/
│   ├── orchestrator.ts        // main game loop
│   ├── llm-gateway.ts         // LLM API calls
│   ├── templates/             // agent personality prompts
│   │   ├── shark.txt
│   │   ├── maniac.txt
│   │   ├── rock.txt
│   │   └── fox.txt
│   ├── solana-client.ts       // interact with on-chain programs
│   ├── ws-feed.ts             // @fastify/websocket spectator feed
│   └── matchmaker.ts          // table creation and filling
```

### 4.2 Turn Orchestrator Loop

```
async function runGame(tableId):
    // 1. Delegate state to PER
    await delegateToPER(tableId)

    // 2. Initialize game on PER (triggers VRF + deal)
    await initializeGame(tableId, players)

    // 3. Game loop
    while gameState.phase != Finished:
        activePlayer = gameState.players[gameState.active_player]

        // 4. Read visible state for this agent
        visibleState = {
            community_cards: gameState.community_cards,
            pot: gameState.pot,
            current_bet: gameState.current_bet,
            my_hand: readPlayerHand(activePlayer),  // PER permissioned read
            my_chips: activePlayer.chips,
            opponents: gameState.players.map(p => ({
                status: p.status,
                chips: p.chips,
                last_action: p.last_action,
                current_round_bet: p.current_round_bet,
                // NOTE: no hand — private!
            })),
            phase: gameState.phase,
        }

        // 5. Get LLM decision
        action = await getLLMAction(activePlayer.template, visibleState)

        // 6. Submit action to PER
        await submitPlayerAction(tableId, gameState.active_player, action)

        // 7. Broadcast to spectators (public state only)
        broadcastToSpectators(tableId, {
            phase: gameState.phase,
            pot: gameState.pot,
            community_cards: gameState.community_cards,
            active_player: gameState.active_player,
            players: sanitizedPlayerStates,  // no hands until showdown
            last_action: { player: activePlayer.display_name, action },
            reasoning: action.reasoning,  // LLM's explanation (optional)
        })

        // 8. Small delay for spectator experience
        await sleep(2000)  // 2 seconds between actions

    // 9. Showdown — reveal all hands
    broadcastShowdown(tableId, allHands)

    // 10. Undelegate from PER back to L1
    await undelegateFromPER(tableId)

    // 11. Settle on L1
    await settleTable(tableId, winner)
    await settleBettingPool(tableId, winner)
```

### 4.3 LLM Gateway

```
async function getLLMAction(template, visibleState):
    systemPrompt = loadTemplate(template)  // e.g., shark.txt

    userPrompt = `
        Game Phase: ${visibleState.phase}
        Your Hand: ${formatCards(visibleState.my_hand)}
        Community Cards: ${formatCards(visibleState.community_cards)}
        Pot: ${visibleState.pot}
        Current Bet to Call: ${visibleState.current_bet}
        Your Chips: ${visibleState.my_chips}
        Your Current Bet This Round: ${visibleState.my_current_bet}

        Opponents:
        ${visibleState.opponents.map(formatOpponent).join('\n')}

        Legal actions: ${getLegalActions(visibleState)}

        Respond with JSON: { "action": "fold|check|call|raise|allin", "raise_amount": number|null, "reasoning": "brief explanation" }
    `

    response = await llm.chat({
        model: "claude-haiku-4-5-20251001",  // fast + cheap
        system: systemPrompt,
        user: userPrompt,
        max_tokens: 200,
    })

    return parseAction(response)
```

### 4.4 Agent Templates (System Prompts)

**Shark (shark.txt)**
```
You are a tight-aggressive poker player. You only play strong starting hands
(top 20%). When you do play, you bet and raise aggressively. You rarely call —
you either raise or fold. You look for spots to put maximum pressure on opponents.
You are patient and disciplined. You occasionally bluff in good spots (when the
board favors your perceived range), but mostly play straightforward value poker.
```

**Maniac (maniac.txt)**
```
You are a loose-aggressive poker player. You play a wide range of hands and
apply constant pressure through raises and re-raises. You bluff frequently —
roughly 40% of your bets are bluffs. You love to make big bets to force
opponents to make difficult decisions. You are unpredictable and creative.
You sometimes make unconventional plays to confuse opponents.
```

**Rock (rock.txt)**
```
You are an ultra-conservative poker player. You only play premium hands
(top 10%): AA, KK, QQ, JJ, AKs, AKo. You fold everything else preflop.
When you do play, you bet for value. You rarely bluff (less than 5% of bets).
You are extremely patient and wait for strong spots. You minimize losses
by avoiding marginal situations.
```

**Fox (fox.txt)**
```
You are an adaptive poker player. You start tight and observe opponent patterns.
As the game progresses, you exploit tendencies you detect:
- Against tight players: steal more pots with well-timed bluffs
- Against loose players: tighten up and value bet more
- Against aggressive players: trap with slow-plays
You adjust your strategy every few hands based on what you've seen.
You keep track of showdown results to calibrate opponent ranges.
```

### 4.5 Matchmaker

```
Matchmaker runs continuously:

1. Check for agents in queue (want to play)
2. Group by wager tier ($1, $3, $5, $10)
3. When 6 agents in same tier → create table
4. Call create_table on L1
5. Call join_table for each agent (deposits wager)
6. Open spectator betting pool
7. Wait 60 seconds for spectator bets
8. Lock betting, start game
```

---

## 5. Frontend

### 5.1 Tech Stack

- **Next.js** (App Router)
- **Tailwind CSS** for styling
- **@solana/wallet-adapter** for wallet connection
- **Native WebSocket** client for live game feed
- **Motion** (motion.dev) for card/chip animations

### 5.2 Pages

```
/                           → Landing page (overview, stats)
/play                       → Create/manage your agent
/play/create                → Pick template, name agent, fund wallet
/play/dashboard             → Agent stats, wallet balance, withdraw
/tables                     → Browse open/live tables
/tables/[id]                → Live spectator view of a game
/tables/[id]/bet            → Place spectator bet (pre-game)
/leaderboard                → Top agents by winnings
```

### 5.3 Spectator View (Key Screen)

```
┌──────────────────────────────────────────────────┐
│                SPECTATOR VIEW                     │
│                                                   │
│   Player 1 (Shark)     Player 2 (Fox)            │
│   [$45] 🟢 Active      [$32] Folded              │
│   [??][??]              [--][--]                  │
│                                                   │
│        Player 3 (Rock)                            │
│        [$50] 🟢 Waiting                           │
│        [??][??]                                   │
│                                                   │
│           ┌─────────────────┐                     │
│           │  [K♠] [9♥] [3♦] │  Pot: $28          │
│           │    FLOP          │                     │
│           └─────────────────┘                     │
│                                                   │
│        Player 4 (Maniac)                          │
│        [$22] 🟢 THINKING...                       │
│        [??][??]                                   │
│                                                   │
│   Player 5 (Shark)     Player 6 (Fox)            │
│   [$38] 🟢 Active      [$13] All-In              │
│   [??][??]              [??][??]                  │
│                                                   │
│  ┌──────────────────────────────────────────┐     │
│  │ 💭 Maniac is thinking:                   │     │
│  │ "Two overcards on the flop. I have       │     │
│  │  middle pair. The pot odds justify a      │     │
│  │  semi-bluff raise here to put pressure    │     │
│  │  on the remaining players."               │     │
│  │                                           │     │
│  │ Action: RAISE $8                          │     │
│  └──────────────────────────────────────────┘     │
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
  Agent owner → fund_agent(5 SOL)                [L1 tx]
  Agent owner → queue_for_game(wager_tier)       [API call]
  Matchmaker  → create_table(wager_tier)         [L1 tx]
  Matchmaker  → join_table(agent) x6             [L1 tx — escrows wager]
  Matchmaker  → create_pool(table_id)            [L1 tx]

Phase 2: BETTING WINDOW (60 seconds)
──────────────────────────────────────────────────
  Spectator   → place_bet(agent, amount)         [L1 tx]
  Frontend    → show table preview, agent stats
  Timer       → 60s countdown

Phase 3: GAME DELEGATION
──────────────────────────────────────────────────
  Game server → delegate GameState to PER         [L1 tx]
  Game server → delegate PlayerHand[0..5] to PER  [L1 tx]
  Game server → set permissions (each hand → agent only)
  Game server → lock betting pool                 [L1 tx]

Phase 4: GAME PLAY (inside PER)
──────────────────────────────────────────────────
  Game server → initialize_game → triggers VRF    [PER tx]
  VRF oracle  → vrf_callback(randomness)          [PER tx]
              → deck shuffled, hands dealt

  LOOP (until game ends):
    Game server → read GameState (public fields)  [PER read]
    Game server → read PlayerHand[active] (permissioned) [PER read]
    Game server → call LLM with visible state     [HTTP to LLM API]
    LLM         → returns action + reasoning      [HTTP response]
    Game server → player_action(index, action)    [PER tx]
    Game server → broadcast to spectators         [WebSocket]
    (2 second delay for spectator viewing)

Phase 5: SHOWDOWN
──────────────────────────────────────────────────
  Game server → showdown()                        [PER tx]
              → all hands revealed
              → winner determined
  Game server → broadcast final result + all hands [WebSocket]

Phase 6: SETTLEMENT
──────────────────────────────────────────────────
  Game server → undelegate all accounts from PER  [L1 tx]
  Game server → settle_table(winner)              [L1 tx]
              → 95% pot → winner agent wallet
              → 5% pot → platform treasury
  Game server → settle_pool(winner)               [L1 tx]
              → 95% pool → winning bettors (pro-rata)
              → 5% pool → platform treasury
  Game server → update agent stats (wins, earnings) [L1 tx]
```

---

## 7. Cost Estimates (Per Game)

| Item                         | Cost       |
| ---------------------------- | ---------- |
| LLM calls (~800 calls/game)  | ~$0.15     |
| Solana L1 txs (~15 txs)      | ~$0.01     |
| PER txs (~60 txs)            | ~$0.05     |
| VRF request                  | ~$0.01     |
| **Total platform cost**      | **~$0.22** |

Revenue per game ($5 wager tier, 6 players):
| Source                       | Amount     |
| ---------------------------- | ---------- |
| Agent rake (5% of $30 pot)   | $1.50      |
| Spectator rake (5% of ~$100) | $5.00      |
| **Total revenue**            | **~$6.50** |

**Margin: ~$6.28 per game (~97%)**

---

## 8. Tech Stack Summary

| Layer               | Technology                              |
| ------------------- | --------------------------------------- |
| Blockchain          | Solana (mainnet)                        |
| Smart contracts     | Anchor (Rust)                           |
| Game execution      | MagicBlock Private Ephemeral Rollup     |
| Randomness          | MagicBlock VRF                          |
| Game server         | Fastify / TypeScript                    |
| LLM                 | Claude Haiku 4.5 (primary)              |
| Frontend            | Next.js + Tailwind + Motion (motion.dev)|
| Wallet              | Solana Wallet Adapter                   |
| Real-time feed      | WebSocket (@fastify/websocket)          |
| Database            | PostgreSQL (game history, leaderboards) |
| Hosting             | Vercel (frontend) + Railway (server)    |

---

## 9. MVP Milestones

```
M1: On-chain programs (2-3 weeks)
    - Agent Program (create, fund, withdraw)
    - Wager Escrow Program (join, settle, refund)
    - Spectator Betting Program (bet, settle, claim)
    - Deploy to devnet

M2: Poker game program on PER (2-3 weeks)
    - Game state management
    - Poker logic (hand evaluation, betting rounds)
    - VRF card dealing
    - Privacy permissions for player hands
    - Test on MagicBlock devnet TEE

M3: Game server (1-2 weeks)
    - Turn orchestrator
    - LLM gateway + 4 templates
    - Matchmaker
    - Spectator WebSocket feed (@fastify/websocket)

M4: Frontend (2-3 weeks)
    - Landing page
    - Agent creation flow
    - Live spectator view with animations
    - Spectator betting UI
    - Leaderboard

M5: Integration + testing (1-2 weeks)
    - End-to-end testing on devnet
    - Load testing (concurrent games)
    - Security audit (escrow logic)
    - Mainnet deployment
```
