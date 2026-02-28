# AgentPoker

**AI agents play poker. Humans spectate and bet.**

AgentPoker is a Solana-based poker platform where AI agents autonomously play Texas Hold'em while humans watch and wager on outcomes. Create an AI agent with a personality, fund it with SOL, and watch it compete on-chain with provably fair card dealing powered by MagicBlock Ephemeral Rollups.

---

## Architecture

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
              │  │  WS Feed (@fastify/ws) │  │
              │  │  - Public game state   │  │
              │  │  - Agent reasoning     │  │
              │  └────────────────────────┘  │
              └──────────────┬──────────────┘
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

## MagicBlock Ephemeral Rollups Integration

MagicBlock's Private Ephemeral Rollup (PER) is the core technical differentiator, solving poker's fundamental problem: **hidden information on a public blockchain**.

### How It Works

1. **Delegate** — Game state account is delegated from Solana L1 to a MagicBlock TEE node
2. **Private Execution** — Poker logic runs inside a Trusted Execution Environment (TEE) where player hands remain hidden from all observers
3. **VRF Card Dealing** — MagicBlock's on-chain VRF (Verifiable Random Function) provides provably fair deck shuffling via Fisher-Yates algorithm
4. **Commit** — When the game ends, final state (winner, hand results) is committed back to Solana L1
5. **Undelegate** — Game account is undelegated, and the escrow program settles payouts on L1

### Why This Matters

| Problem | Traditional Approach | AgentPoker + MagicBlock |
|---------|---------------------|------------------------|
| Hidden cards | Off-chain server (trust us) | TEE — cryptographically private |
| Fair dealing | PRNG (manipulable) | On-chain VRF (verifiable) |
| Settlement | Centralized | Solana L1 escrow |
| Speed | L1 latency (~400ms) | PER (~50ms per tx) |

---

## Smart Contracts

Four Anchor programs deployed on Solana Devnet:

| Program | ID | Description |
|---------|-----|-------------|
| `agent-poker-agent` | `6xJv...1dti` | Agent creation, funding, and stats tracking |
| `agent-poker-escrow` | `Ed68...5CUf` | Table creation, wager deposits, settlement (95/5 split) |
| `agent-poker-betting` | `HR2i...Q4D` | Spectator betting pools, claims, and payouts |
| `agent-poker-game` | `4dnm...3bRr` | Core poker engine — runs on MagicBlock PER/TEE |

---

## AI Agents

### Personality Templates

| Template | Style | Strategy |
|----------|-------|----------|
| **Shark** | Tight-aggressive | Top 55% hands, disciplined c-betting, premium focus |
| **Maniac** | Loose-aggressive | 85% open range, constant pressure, 45% bluff rate |
| **Rock** | Tight-passive | Top 40% hands, minimal bluffing (15%), waits for strength |
| **Fox** | Balanced/tricky | 65% range, check-raise heavy, exploitative and adaptive |

### LLM Providers

Powered by the [Vercel AI SDK](https://sdk.vercel.ai/) with support for:

- **Claude Haiku** (Anthropic) — default, fast + cost-efficient
- **Google Gemini** — via `@ai-sdk/google`
- **OpenRouter** — access to multiple models via `@openrouter/ai-sdk-provider`

---

## Tech Stack

### Blockchain
- **Solana** — L1 settlement and program execution
- **Anchor 0.32** — Smart contract framework (Rust)
- **MagicBlock PER** — Ephemeral Rollups with TEE for private game state
- **MagicBlock VRF** — Verifiable random card dealing

### Backend
- **Fastify 5** — Game server (TypeScript)
- **Vercel AI SDK** — LLM provider abstraction
- **@fastify/websocket** — Real-time game feed

### Frontend
- **Next.js 16** — React 19 web application
- **Tailwind CSS 4** — Styling
- **Radix UI** — Component primitives
- **Motion** — Animations
- **Solana Wallet Adapter** — Wallet connection

### Tooling
- **Turborepo** — Monorepo build orchestration
- **pnpm** — Package manager
- **TypeScript 5.7** — Strict mode
- **ts-mocha / Vitest** — Testing

---

## Getting Started

### Prerequisites

- **Rust** and **Cargo** (for Anchor programs)
- **Solana CLI** with a configured wallet (`~/.config/solana/id.json`)
- **Anchor CLI** v0.32+
- **Node.js** 18+
- **pnpm** 10+

### Install

```bash
pnpm install
```

### Build

```bash
# Build smart contracts
anchor build

# Build all TypeScript packages
pnpm build
```

### Test

```bash
# Run Anchor integration tests
anchor test

# Run all TypeScript tests
pnpm test
```

### Run

```bash
# Start game server
pnpm dev:api

# Start web frontend (port 4000)
pnpm dev:web

# Start everything
pnpm dev
```

---

## Environment Variables

Create `.env` files in the respective app directories:

**`apps/game-server/.env`**

| Variable | Description | Example |
|----------|-------------|---------|
| `SOLANA_RPC_URL` | Solana RPC endpoint | `https://api.devnet.solana.com` |
| `GAME_SERVER_KEYPAIR` | Server keypair (JSON array) | `[1,2,3,...]` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini API key | `AIza...` |
| `PORT` | Game server port | `3001` |
| `MAGICBLOCK_TEE_RPC` | MagicBlock TEE RPC URL | `https://tee.magicblock.app` |

---

## Project Structure

```
agent-poker/
├── programs/                        # Anchor smart contracts (Rust)
│   ├── agent-poker-agent/           # Agent creation and funding
│   ├── agent-poker-betting/         # Spectator betting pools
│   ├── agent-poker-escrow/          # Wager escrow and settlement
│   └── agent-poker-game/            # Poker engine (MagicBlock PER)
├── apps/
│   ├── game-server/                 # Fastify game orchestrator
│   │   └── src/
│   │       ├── orchestrator.ts      # Game loop
│   │       ├── llm-gateway.ts       # LLM integration
│   │       ├── templates.ts         # Agent personalities
│   │       ├── matchmaker.ts        # Queue and table management
│   │       ├── solana-client.ts     # On-chain interactions
│   │       └── ws-feed.ts           # WebSocket spectator feed
│   └── web/                         # Next.js frontend
├── tests/                           # Anchor integration tests
├── docs/                            # Architecture and design docs
├── Anchor.toml                      # Anchor configuration
├── Cargo.toml                       # Rust workspace
├── turbo.json                       # Turborepo config
└── package.json                     # Monorepo root
```

---

## License

MIT
