# AgentPoker — Implementation Plan

> AI Poker Arena on Solana with MagicBlock Ephemeral Rollups

---

## Table of Contents

1. [Project Setup](#1-project-setup)
2. [Phase 1: On-Chain Programs (L1)](#2-phase-1-on-chain-programs-l1)
3. [Phase 2: Poker Game Program (MagicBlock PER)](#3-phase-2-poker-game-program-magicblock-per)
4. [Phase 3: Game Server](#4-phase-3-game-server)
5. [Phase 4: Frontend](#5-phase-4-frontend)
6. [Phase 5: Integration & Testing](#6-phase-5-integration--testing)
7. [Complete TODO List](#7-complete-todo-list)

---

## 1. Project Setup

### 1.1 Monorepo Structure

```
agent-poker/
├── docs/                          # Documentation
├── apps/                          # JS/TS applications (pnpm workspace)
│   ├── web/                       # Next.js frontend (@repo/web)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── lib/
│   │   ├── package.json
│   │   └── next.config.ts
│   └── game-server/               # Fastify turn orchestrator (@repo/game-server)
│       ├── src/
│       │   ├── server.ts          # Fastify app entry point
│       │   ├── orchestrator.ts
│       │   ├── llm-gateway.ts
│       │   ├── matchmaker.ts
│       │   ├── ws-feed.ts         # WebSocket spectator feed
│       │   ├── solana-client.ts
│       │   ├── routes/
│       │   │   ├── tables.ts
│       │   │   ├── agents.ts
│       │   │   └── leaderboard.ts
│       │   └── templates/
│       ├── package.json
│       └── tsconfig.json
├── programs/                      # Anchor programs (Rust)
│   ├── agent-poker-agent/         # Agent creation + funding
│   ├── agent-poker-escrow/        # Wager escrow + settlement
│   ├── agent-poker-betting/       # Spectator betting pools
│   └── agent-poker-game/          # Poker game logic (runs on PER)
├── tests/                         # Anchor integration tests
├── Anchor.toml
├── Cargo.toml
├── pnpm-workspace.yaml            # pnpm workspace config
├── turbo.json                     # Turborepo pipeline
├── tsconfig.base.json             # Shared TypeScript base config
└── package.json                   # Root: turbo + prettier only
```

### 1.2 Initialize Project

```bash
# Initialize Anchor workspace
anchor init agent-poker
cd agent-poker

# Create additional programs
anchor new agent-poker-agent
anchor new agent-poker-escrow
anchor new agent-poker-betting
anchor new agent-poker-game

# Install MagicBlock dependencies in programs
cd programs/agent-poker-game
cargo add ephemeral-rollups-sdk --features anchor
cargo add ephemeral_vrf_sdk --features anchor

# Initialize game server (Fastify) — under apps/
mkdir -p apps/game-server/src/routes
cd apps/game-server
pnpm init
pnpm add fastify @fastify/websocket @fastify/cors @fastify/type-provider-typebox \
  @sinclair/typebox @coral-xyz/anchor @solana/web3.js \
  @magicblock-labs/ephemeral-rollups-sdk @anthropic-ai/sdk dotenv
pnpm add -D typescript @types/node tsx

# Initialize frontend — under apps/
cd ../../
npx create-next-app@latest apps/web --typescript --tailwind --app --src-dir
cd apps/web
pnpm add @solana/wallet-adapter-react @solana/wallet-adapter-react-ui \
  @solana/wallet-adapter-wallets @solana/web3.js motion

# Install pnpm workspace deps from root
cd ../../
pnpm install
```

### 1.3 Anchor.toml Configuration

```toml
[features]
seeds = false
skip-lint = false

[programs.devnet]
agent_poker_agent = "AGENT_PROGRAM_ID"
agent_poker_escrow = "ESCROW_PROGRAM_ID"
agent_poker_betting = "BETTING_PROGRAM_ID"
agent_poker_game = "POKER_PROGRAM_ID"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
```

---

## 2. Phase 1: On-Chain Programs (L1)

These programs live on Solana L1 and handle agent identity, wager escrow, and spectator betting.

### 2.1 agent-poker-agent Program

**File: `programs/agent-poker-agent/src/lib.rs`**

```rust
use anchor_lang::prelude::*;

declare_id!("AGENT_PROGRAM_ID");

pub const AGENT_SEED: &[u8] = b"agent";
pub const AGENT_VAULT_SEED: &[u8] = b"agent_vault";
pub const MAX_DISPLAY_NAME_LEN: usize = 20;

#[program]
pub mod agent_poker_agent {
    use super::*;

    pub fn create_agent(
        ctx: Context<CreateAgent>,
        template: u8,
        display_name: String,
    ) -> Result<()> {
        require!(template <= 3, AgentError::InvalidTemplate);
        require!(
            display_name.len() <= MAX_DISPLAY_NAME_LEN,
            AgentError::NameTooLong
        );

        let agent = &mut ctx.accounts.agent;
        agent.owner = ctx.accounts.owner.key();
        agent.template = template;
        agent.display_name = display_name;
        agent.vault = ctx.accounts.vault.key();
        agent.total_games = 0;
        agent.total_wins = 0;
        agent.total_earnings = 0;
        agent.created_at = Clock::get()?.unix_timestamp;
        agent.bump = ctx.bumps.agent;
        agent.vault_bump = ctx.bumps.vault;

        Ok(())
    }

    pub fn fund_agent(ctx: Context<FundAgent>, amount: u64) -> Result<()> {
        require!(amount > 0, AgentError::ZeroAmount);

        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.owner.key(),
            &ctx.accounts.vault.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.owner.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, AgentError::ZeroAmount);
        require!(
            ctx.accounts.vault.lamports() >= amount,
            AgentError::InsufficientFunds
        );

        // Transfer from PDA vault to owner
        let agent_key = ctx.accounts.agent.owner.key();
        let seeds = &[
            AGENT_VAULT_SEED,
            agent_key.as_ref(),
            &[ctx.accounts.agent.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        **ctx.accounts.vault.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.owner.try_borrow_mut_lamports()? += amount;

        Ok(())
    }

    pub fn update_stats(
        ctx: Context<UpdateStats>,
        games_delta: u64,
        wins_delta: u64,
        earnings_delta: i64,
    ) -> Result<()> {
        let agent = &mut ctx.accounts.agent;
        agent.total_games += games_delta;
        agent.total_wins += wins_delta;
        agent.total_earnings += earnings_delta;
        Ok(())
    }
}

// --- Accounts ---

#[account]
pub struct AgentAccount {
    pub owner: Pubkey,           // 32
    pub template: u8,            // 1
    pub display_name: String,    // 4 + 20
    pub vault: Pubkey,           // 32
    pub total_games: u64,        // 8
    pub total_wins: u64,         // 8
    pub total_earnings: i64,     // 8
    pub created_at: i64,         // 8
    pub bump: u8,                // 1
    pub vault_bump: u8,          // 1
}
// Space: 8 (discriminator) + 32 + 1 + 24 + 32 + 8 + 8 + 8 + 8 + 1 + 1 = 131

// --- Contexts ---

#[derive(Accounts)]
pub struct CreateAgent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + 131,
        seeds = [AGENT_SEED, owner.key().as_ref()],
        bump
    )]
    pub agent: Account<'info, AgentAccount>,

    /// CHECK: PDA vault for agent's SOL
    #[account(
        mut,
        seeds = [AGENT_VAULT_SEED, owner.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundAgent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [AGENT_SEED, owner.key().as_ref()],
        bump = agent.bump,
        has_one = owner,
    )]
    pub agent: Account<'info, AgentAccount>,

    /// CHECK: Agent vault PDA
    #[account(
        mut,
        seeds = [AGENT_VAULT_SEED, owner.key().as_ref()],
        bump = agent.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [AGENT_SEED, owner.key().as_ref()],
        bump = agent.bump,
        has_one = owner,
    )]
    pub agent: Account<'info, AgentAccount>,

    /// CHECK: Agent vault PDA
    #[account(
        mut,
        seeds = [AGENT_VAULT_SEED, owner.key().as_ref()],
        bump = agent.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateStats<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,  // game server authority

    #[account(mut)]
    pub agent: Account<'info, AgentAccount>,
}

// --- Errors ---

#[error_code]
pub enum AgentError {
    #[msg("Invalid template. Must be 0-3.")]
    InvalidTemplate,
    #[msg("Display name too long. Max 20 characters.")]
    NameTooLong,
    #[msg("Amount must be greater than zero.")]
    ZeroAmount,
    #[msg("Insufficient funds in agent vault.")]
    InsufficientFunds,
}
```

### 2.2 agent-poker-escrow Program

**File: `programs/agent-poker-escrow/src/lib.rs`**

```rust
use anchor_lang::prelude::*;

declare_id!("ESCROW_PROGRAM_ID");

pub const TABLE_SEED: &[u8] = b"table";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const MAX_PLAYERS: usize = 6;
pub const RAKE_BPS: u64 = 500; // 5%

#[program]
pub mod agent_poker_escrow {
    use super::*;

    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        // One-time setup for platform treasury PDA
        Ok(())
    }

    pub fn create_table(
        ctx: Context<CreateTable>,
        table_id: u64,
        wager_tier: u64,
    ) -> Result<()> {
        let table = &mut ctx.accounts.table;
        table.table_id = table_id;
        table.wager_tier = wager_tier;
        table.players = [Pubkey::default(); MAX_PLAYERS];
        table.player_count = 0;
        table.status = TableStatus::Open;
        table.winner = None;
        table.created_at = Clock::get()?.unix_timestamp;
        table.bump = ctx.bumps.table;
        table.authority = ctx.accounts.authority.key();
        Ok(())
    }

    pub fn join_table(ctx: Context<JoinTable>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        require!(table.status == TableStatus::Open, EscrowError::TableNotOpen);
        require!(
            (table.player_count as usize) < MAX_PLAYERS,
            EscrowError::TableFull
        );

        // Transfer wager from agent vault to table escrow
        let amount = table.wager_tier;
        **ctx.accounts.agent_vault.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.table_vault.try_borrow_mut_lamports()? += amount;

        // Register player
        table.players[table.player_count as usize] = ctx.accounts.agent.key();
        table.player_count += 1;

        // If full, mark as full
        if table.player_count as usize == MAX_PLAYERS {
            table.status = TableStatus::Full;
        }

        Ok(())
    }

    pub fn start_game(ctx: Context<StartGame>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        require!(table.status == TableStatus::Full, EscrowError::NotFull);
        table.status = TableStatus::InProgress;
        Ok(())
    }

    pub fn settle_table(
        ctx: Context<SettleTable>,
        winner_index: u8,
    ) -> Result<()> {
        let table = &mut ctx.accounts.table;
        require!(
            table.status == TableStatus::InProgress,
            EscrowError::NotInProgress
        );
        require!(
            (winner_index as usize) < MAX_PLAYERS,
            EscrowError::InvalidWinner
        );

        let total_pot = table.wager_tier * MAX_PLAYERS as u64;
        let rake = total_pot * RAKE_BPS / 10_000;
        let winner_payout = total_pot - rake;

        // Pay winner
        **ctx.accounts.table_vault.try_borrow_mut_lamports()? -= winner_payout;
        **ctx.accounts.winner_vault.try_borrow_mut_lamports()? += winner_payout;

        // Pay treasury
        **ctx.accounts.table_vault.try_borrow_mut_lamports()? -= rake;
        **ctx.accounts.treasury.try_borrow_mut_lamports()? += rake;

        table.winner = Some(table.players[winner_index as usize]);
        table.status = TableStatus::Settled;

        Ok(())
    }

    pub fn refund_table(ctx: Context<RefundTable>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        require!(
            table.status == TableStatus::Open || table.status == TableStatus::Full,
            EscrowError::CannotRefund
        );

        // Refund each player their wager
        // (simplified — full impl iterates over remaining accounts)
        table.status = TableStatus::Settled;
        Ok(())
    }
}

// --- State ---

#[account]
pub struct TableEscrow {
    pub table_id: u64,
    pub wager_tier: u64,
    pub players: [Pubkey; 6],
    pub player_count: u8,
    pub status: TableStatus,
    pub winner: Option<Pubkey>,
    pub created_at: i64,
    pub bump: u8,
    pub authority: Pubkey,
}
// Space: 8 + 8 + 8 + (32*6) + 1 + 1 + 33 + 8 + 1 + 32 = 292

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TableStatus {
    Open,
    Full,
    InProgress,
    Settled,
}

// --- Errors ---

#[error_code]
pub enum EscrowError {
    #[msg("Table is not open for joining.")]
    TableNotOpen,
    #[msg("Table is full.")]
    TableFull,
    #[msg("Table is not full yet.")]
    NotFull,
    #[msg("Game is not in progress.")]
    NotInProgress,
    #[msg("Invalid winner index.")]
    InvalidWinner,
    #[msg("Cannot refund in current state.")]
    CannotRefund,
}
```

### 2.3 agent-poker-betting Program

**File: `programs/agent-poker-betting/src/lib.rs`**

```rust
use anchor_lang::prelude::*;

declare_id!("BETTING_PROGRAM_ID");

pub const POOL_SEED: &[u8] = b"bet_pool";
pub const BET_SEED: &[u8] = b"bet";
pub const RAKE_BPS: u64 = 500; // 5%
pub const MAX_BETS: usize = 50;

#[program]
pub mod agent_poker_betting {
    use super::*;

    pub fn create_pool(
        ctx: Context<CreatePool>,
        table_id: u64,
        agents: [Pubkey; 6],
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.table_id = table_id;
        pool.agents = agents;
        pool.total_pool = 0;
        pool.bet_count = 0;
        pool.status = PoolStatus::Open;
        pool.winner = None;
        pool.bump = ctx.bumps.pool;
        Ok(())
    }

    pub fn place_bet(
        ctx: Context<PlaceBet>,
        agent_index: u8,
        amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(pool.status == PoolStatus::Open, BetError::PoolNotOpen);
        require!(amount > 0, BetError::ZeroAmount);
        require!((agent_index as usize) < 6, BetError::InvalidAgent);

        // Transfer SOL from bettor to pool vault
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.bettor.key(),
            &ctx.accounts.pool_vault.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.bettor.to_account_info(),
                ctx.accounts.pool_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Record bet in separate PDA
        let bet = &mut ctx.accounts.bet;
        bet.bettor = ctx.accounts.bettor.key();
        bet.pool = ctx.accounts.pool.key();
        bet.agent_index = agent_index;
        bet.amount = amount;
        bet.claimed = false;
        bet.bump = ctx.bumps.bet;

        pool.total_pool += amount;
        pool.bet_count += 1;

        Ok(())
    }

    pub fn lock_pool(ctx: Context<LockPool>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(pool.status == PoolStatus::Open, BetError::PoolNotOpen);
        pool.status = PoolStatus::Locked;
        Ok(())
    }

    pub fn settle_pool(
        ctx: Context<SettlePool>,
        winner_index: u8,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(pool.status == PoolStatus::Locked, BetError::PoolNotLocked);
        pool.winner = Some(winner_index);
        pool.status = PoolStatus::Settled;

        // Calculate rake and transfer to treasury
        let rake = pool.total_pool * RAKE_BPS / 10_000;
        **ctx.accounts.pool_vault.try_borrow_mut_lamports()? -= rake;
        **ctx.accounts.treasury.try_borrow_mut_lamports()? += rake;

        Ok(())
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let pool = &ctx.accounts.pool;
        let bet = &mut ctx.accounts.bet;
        require!(pool.status == PoolStatus::Settled, BetError::PoolNotSettled);
        require!(!bet.claimed, BetError::AlreadyClaimed);
        require!(
            Some(bet.agent_index) == pool.winner,
            BetError::NotWinningBet
        );

        // Calculate pro-rata share
        // winning_bets_total is passed by the client (verified on-chain)
        let pool_after_rake = pool.total_pool * (10_000 - RAKE_BPS) / 10_000;
        // Simplified: payout = (bet.amount / winning_total) * pool_after_rake
        // Full implementation uses u128 math to avoid overflow

        bet.claimed = true;

        Ok(())
    }
}

// --- State ---

#[account]
pub struct BettingPool {
    pub table_id: u64,
    pub agents: [Pubkey; 6],
    pub total_pool: u64,
    pub bet_count: u16,
    pub status: PoolStatus,
    pub winner: Option<u8>,
    pub bump: u8,
}

#[account]
pub struct BetAccount {
    pub bettor: Pubkey,
    pub pool: Pubkey,
    pub agent_index: u8,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PoolStatus {
    Open,
    Locked,
    Settled,
}

#[error_code]
pub enum BetError {
    #[msg("Pool is not open.")]
    PoolNotOpen,
    #[msg("Pool is not locked.")]
    PoolNotLocked,
    #[msg("Pool is not settled.")]
    PoolNotSettled,
    #[msg("Amount must be > 0.")]
    ZeroAmount,
    #[msg("Invalid agent index.")]
    InvalidAgent,
    #[msg("Already claimed.")]
    AlreadyClaimed,
    #[msg("Not a winning bet.")]
    NotWinningBet,
}
```

---

## 3. Phase 2: Poker Game Program (MagicBlock PER)

This program runs inside a Private Ephemeral Rollup (TEE). It handles all poker game
logic with hidden player hands.

### 3.1 agent-poker-game Program

**File: `programs/agent-poker-game/src/lib.rs`**

```rust
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::{
    CreatePermissionCpiBuilder, UpdatePermissionCpiBuilder,
};
use ephemeral_rollups_sdk::access_control::structs::{Member, MembersArgs};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::consts::PERMISSION_PROGRAM_ID;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;
use ephemeral_vrf_sdk::anchor::vrf;
use ephemeral_vrf_sdk::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_vrf_sdk::types::SerializableAccountMeta;

pub mod hand_eval;

declare_id!("4dnm62opQrwADRgKFoGHrpt8zCWkheTRrs3uVCAa3bRr");

pub const GAME_SEED: &[u8] = b"poker_game";
pub const HAND_SEED: &[u8] = b"player_hand";
pub const MAX_PLAYERS: usize = 6;
pub const SMALL_BLIND_RATIO: u64 = 50;   // 5%  of wager_tier
pub const BIG_BLIND_RATIO: u64 = 100;    // 10% of wager_tier
pub const RATIO_BASE: u64 = 1000;

#[ephemeral]
#[program]
pub mod agent_poker_game {
    use super::*;

    // ── 1. Create game & per-player hand PDAs (called on L1) ────────────
    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: u64,
        table_id: u64,
        players: Vec<Pubkey>,
        wager_tier: u64,
    ) -> Result<()> {
        let player_count = players.len();
        require!(
            player_count >= 2 && player_count <= MAX_PLAYERS,
            GameError::InvalidPlayerCount
        );

        let game = &mut ctx.accounts.game;
        game.game_id = game_id;
        game.table_id = table_id;
        game.player_count = player_count as u8;
        game.wager_tier = wager_tier;
        game.phase = GamePhase::Waiting;
        game.pot = 0;
        game.current_bet = 0;
        game.dealer_index = 0;
        game.current_player = 0;
        game.last_raiser = 0;
        game.community_cards = [255u8; 5];
        game.community_count = 0;
        game.winner_index = 255;
        game.authority = ctx.accounts.authority.key();
        game.bump = ctx.bumps.game;
        game.created_at = Clock::get()?.unix_timestamp;
        game.last_action_at = game.created_at;

        for i in 0..MAX_PLAYERS {
            if i < player_count {
                game.players[i] = players[i];
                game.player_status[i] = PlayerStatus::Active as u8;
            } else {
                game.players[i] = Pubkey::default();
                game.player_status[i] = PlayerStatus::Empty as u8;
            }
            game.player_bets[i] = 0;
        }

        // Initialise each PlayerHand PDA (hand0..hand5)
        // (6 separate accounts passed in CreateGame context — see below)
        let hands = [
            &mut ctx.accounts.hand0, &mut ctx.accounts.hand1,
            &mut ctx.accounts.hand2, &mut ctx.accounts.hand3,
            &mut ctx.accounts.hand4, &mut ctx.accounts.hand5,
        ];
        for (i, hand) in hands.into_iter().enumerate() {
            hand.game_id = game_id;
            hand.player = if i < player_count { players[i] } else { Pubkey::default() };
            hand.hand = [255u8; 2];
        }

        Ok(())
    }

    // ── 2. Generic PDA delegation (GameState or PlayerHand) ──────────────
    /// Uses a generic `DelegatePda` context with `AccountType` enum to delegate
    /// either the GameState or any PlayerHand PDA to the TEE validator.
    pub fn delegate_pda(ctx: Context<DelegatePda>, account_type: AccountType) -> Result<()> {
        let seed_data = derive_seeds(&account_type);
        let seeds_refs: Vec<&[u8]> = seed_data.iter().map(|s| s.as_slice()).collect();

        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &seeds_refs,
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

    // ── 3. Create TEE permission for a PDA (on-chain via CPI) ────────────
    /// Creates a permission entry restricting who can read the account
    /// inside the TEE. Called on L1 before delegation.
    pub fn create_permission(
        ctx: Context<CreatePermission>,
        account_type: AccountType,
        members: Option<Vec<Member>>,
    ) -> Result<()> {
        let seed_data = derive_seeds(&account_type);
        let (_, bump) = Pubkey::find_program_address(
            &seed_data.iter().map(|s| s.as_slice()).collect::<Vec<_>>(),
            &crate::ID,
        );

        let mut seeds = seed_data.clone();
        seeds.push(vec![bump]);
        let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();

        CreatePermissionCpiBuilder::new(&ctx.accounts.permission_program)
            .permissioned_account(&ctx.accounts.permissioned_account.to_account_info())
            .permission(&ctx.accounts.permission)
            .payer(&ctx.accounts.payer)
            .system_program(&ctx.accounts.system_program)
            .args(MembersArgs { members })
            .invoke_signed(&[seed_refs.as_slice()])?;

        Ok(())
    }

    // ── 4. VRF: request a random shuffle ──────────────────────────────────
    /// Submitted on the ER after delegation. The accounts_metas include the
    /// GameState AND all 6 PlayerHand PDAs so the callback can write to them.
    pub fn request_shuffle(ctx: Context<RequestShuffle>, client_seed: u8) -> Result<()> {
        require!(
            ctx.accounts.game.phase == GamePhase::Waiting,
            GameError::InvalidPhase
        );

        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator:
                instruction::CallbackShuffle::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![
                SerializableAccountMeta { pubkey: ctx.accounts.game.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: ctx.accounts.hand0.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: ctx.accounts.hand1.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: ctx.accounts.hand2.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: ctx.accounts.hand3.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: ctx.accounts.hand4.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: ctx.accounts.hand5.key(), is_signer: false, is_writable: true },
            ]),
            ..Default::default()
        });

        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    // ── 5. VRF callback: Fisher-Yates shuffle + deal + blinds ──────────────
    /// Called by the VRF oracle via CPI. Shuffles the deck, deals hole cards
    /// into separate PlayerHand PDAs (NOT stored in GameState), and posts blinds.
    pub fn callback_shuffle(
        ctx: Context<CallbackShuffle>,
        randomness: [u8; 32],
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;

        // Build fresh ordered deck and shuffle with VRF randomness
        let mut deck = [0u8; 52];
        for i in 0..52u8 { deck[i as usize] = i; }
        for i in (1..52usize).rev() {
            let j = ephemeral_vrf_sdk::rnd::random_u8_with_range(&randomness, 0, i as u8) as usize;
            deck.swap(i, j);
        }
        game.deck = deck;

        // Deal 2 hole cards per player into SEPARATE PlayerHand PDAs
        ctx.accounts.hand0.hand = [deck[0], deck[1]];
        ctx.accounts.hand1.hand = [deck[2], deck[3]];
        ctx.accounts.hand2.hand = [deck[4], deck[5]];
        ctx.accounts.hand3.hand = [deck[6], deck[7]];
        ctx.accounts.hand4.hand = [deck[8], deck[9]];
        ctx.accounts.hand5.hand = [deck[10], deck[11]];

        // Community cards at indices 12-16 (stored on GameState)
        game.community_cards = [deck[12], deck[13], deck[14], deck[15], deck[16]];

        // Post blinds using checked math
        let small_blind = game.wager_tier
            .checked_mul(SMALL_BLIND_RATIO).ok_or(GameError::MathOverflow)?
            .checked_div(RATIO_BASE).ok_or(GameError::MathOverflow)?;
        let big_blind = game.wager_tier
            .checked_mul(BIG_BLIND_RATIO).ok_or(GameError::MathOverflow)?
            .checked_div(RATIO_BASE).ok_or(GameError::MathOverflow)?;

        let sb_idx = ((game.dealer_index + 1) % game.player_count) as usize;
        let bb_idx = ((game.dealer_index + 2) % game.player_count) as usize;
        game.player_bets[sb_idx] = small_blind;
        game.player_bets[bb_idx] = big_blind;
        game.pot = small_blind.checked_add(big_blind).ok_or(GameError::MathOverflow)?;
        game.current_bet = big_blind;

        // First to act is left of big blind
        let first = ((game.dealer_index + 3) % game.player_count) as usize;
        game.current_player = first as u8;
        game.last_raiser = bb_idx as u8;
        game.community_count = 0;
        game.phase = GamePhase::Preflop;
        game.last_action_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    // ── 6. Player action (fold / check / call / raise / allin) ──────────
    /// Actions operate on flat arrays (player_status, player_bets) instead of
    /// embedded PlayerState structs. Uses u8 action type + raise_amount.
    pub fn player_action(ctx: Context<PlayerAction>, action: u8, raise_amount: u64) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            matches!(game.phase, GamePhase::Preflop | GamePhase::Flop | GamePhase::Turn | GamePhase::River),
            GameError::InvalidPhase
        );

        let player_idx = game.current_player as usize;
        require!(
            game.player_status[player_idx] == PlayerStatus::Active as u8,
            GameError::PlayerNotActive
        );

        let action_type = ActionType::from_u8(action)?;
        match action_type {
            ActionType::Fold => {
                game.player_status[player_idx] = PlayerStatus::Folded as u8;
            }
            ActionType::Check => {
                require!(game.player_bets[player_idx] == game.current_bet, GameError::CannotCheck);
            }
            ActionType::Call => {
                let call_amount = game.current_bet
                    .checked_sub(game.player_bets[player_idx]).ok_or(GameError::MathOverflow)?;
                game.player_bets[player_idx] = game.current_bet;
                game.pot = game.pot.checked_add(call_amount).ok_or(GameError::MathOverflow)?;
            }
            ActionType::Raise => {
                require!(raise_amount > game.current_bet, GameError::RaiseTooSmall);
                let additional = raise_amount
                    .checked_sub(game.player_bets[player_idx]).ok_or(GameError::MathOverflow)?;
                game.player_bets[player_idx] = raise_amount;
                game.current_bet = raise_amount;
                game.pot = game.pot.checked_add(additional).ok_or(GameError::MathOverflow)?;
                game.last_raiser = player_idx as u8;
            }
            ActionType::AllIn => {
                let all_in_amount = game.wager_tier;
                let additional = all_in_amount
                    .checked_sub(game.player_bets[player_idx]).ok_or(GameError::MathOverflow)?;
                game.player_bets[player_idx] = all_in_amount;
                if all_in_amount > game.current_bet {
                    game.current_bet = all_in_amount;
                    game.last_raiser = player_idx as u8;
                }
                game.pot = game.pot.checked_add(additional).ok_or(GameError::MathOverflow)?;
                game.player_status[player_idx] = PlayerStatus::AllIn as u8;
            }
        }

        game.last_action_at = Clock::get()?.unix_timestamp;

        // Auto-finish if only one player remains
        let active_count = count_active_players(game);
        if active_count <= 1 {
            game.phase = GamePhase::Showdown;
            return Ok(());
        }

        // Advance turn or phase
        let next = find_next_active_player(game, player_idx);
        if next == game.last_raiser as usize || is_betting_round_complete(game) {
            advance_phase(game)?;
        } else {
            game.current_player = next as u8;
        }

        Ok(())
    }

    // ── 7. Showdown: reveal hands, evaluate winner, commit & undelegate ──
    /// Combined showdown + commit instruction. The #[commit] macro on the
    /// Showdown context injects magic_context and magic_program.
    /// Steps: (1) Reveal all hands by UpdatePermission → members: None,
    /// (2) evaluate winner via hand_eval, (3) exit() + commit_and_undelegate.
    pub fn showdown(ctx: Context<Showdown>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.phase == GamePhase::Showdown
                || count_active_players(game) <= 1
                || game.phase == GamePhase::River,
            GameError::InvalidPhase
        );

        let permission_program = &ctx.accounts.permission_program.to_account_info();

        // ── Reveal all PlayerHand PDAs (set members → None = public) ────
        let hand_infos = [
            (&ctx.accounts.hand0, &ctx.accounts.permission_hand0),
            (&ctx.accounts.hand1, &ctx.accounts.permission_hand1),
            (&ctx.accounts.hand2, &ctx.accounts.permission_hand2),
            (&ctx.accounts.hand3, &ctx.accounts.permission_hand3),
            (&ctx.accounts.hand4, &ctx.accounts.permission_hand4),
            (&ctx.accounts.hand5, &ctx.accounts.permission_hand5),
        ];

        for (i, (hand_acc, perm_acc)) in hand_infos.iter().enumerate() {
            if game.player_status[i] == PlayerStatus::Empty as u8 { continue; }
            let game_id_bytes = game.game_id.to_le_bytes();
            let seat_byte = [i as u8];
            let hand_bump = hand_acc.bump;
            UpdatePermissionCpiBuilder::new(permission_program)
                .permissioned_account(&hand_acc.to_account_info(), true)
                .authority(&hand_acc.to_account_info(), false)
                .permission(&perm_acc.to_account_info())
                .args(MembersArgs { members: None }) // None = public
                .invoke_signed(&[&[HAND_SEED, game_id_bytes.as_ref(), seat_byte.as_ref(), &[hand_bump]]])?;
        }

        // ── Determine winner ──────────────────────────────────────────────
        let active_count = count_active_players(game);
        if active_count == 1 {
            for i in 0..game.player_count as usize {
                let s = game.player_status[i];
                if s == PlayerStatus::Active as u8 || s == PlayerStatus::AllIn as u8 {
                    game.winner_index = i as u8;
                    break;
                }
            }
        } else {
            let hands = [
                (game.player_status[0], ctx.accounts.hand0.hand),
                (game.player_status[1], ctx.accounts.hand1.hand),
                (game.player_status[2], ctx.accounts.hand2.hand),
                (game.player_status[3], ctx.accounts.hand3.hand),
                (game.player_status[4], ctx.accounts.hand4.hand),
                (game.player_status[5], ctx.accounts.hand5.hand),
            ];
            let winner = hand_eval::evaluate_winner(&hands, &game.community_cards);
            game.winner_index = winner as u8;
        }

        game.phase = GamePhase::Complete;
        game.last_action_at = Clock::get()?.unix_timestamp;

        emit!(GameFinished {
            game_id: game.game_id,
            winner_index: game.winner_index,
            winner_pubkey: game.players[game.winner_index as usize],
            pot: game.pot,
        });

        // ── CRITICAL: Serialize account data before commit ──────────────
        game.exit(&crate::ID)?;

        // ── Commit state to L1 and undelegate ───────────────────────────
        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.game.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;

        Ok(())
    }
}

// ─── Helper functions ────────────────────────────────────────────────────────

fn count_active_players(game: &GameState) -> u8 {
    (0..game.player_count as usize)
        .filter(|&i| {
            let s = game.player_status[i];
            s == PlayerStatus::Active as u8 || s == PlayerStatus::AllIn as u8
        })
        .count() as u8
}

fn find_next_active_player(game: &GameState, from: usize) -> usize {
    let pc = game.player_count as usize;
    let mut idx = (from + 1) % pc;
    for _ in 0..pc {
        if game.player_status[idx] == PlayerStatus::Active as u8 { return idx; }
        idx = (idx + 1) % pc;
    }
    from
}

fn is_betting_round_complete(game: &GameState) -> bool {
    for i in 0..game.player_count as usize {
        if game.player_status[i] == PlayerStatus::Active as u8
            && game.player_bets[i] != game.current_bet
        { return false; }
    }
    true
}

fn advance_phase(game: &mut GameState) -> Result<()> {
    match game.phase {
        GamePhase::Preflop => { game.phase = GamePhase::Flop; game.community_count = 3; }
        GamePhase::Flop    => { game.phase = GamePhase::Turn; game.community_count = 4; }
        GamePhase::Turn    => { game.phase = GamePhase::River; game.community_count = 5; }
        GamePhase::River   => { game.phase = GamePhase::Showdown; return Ok(()); }
        _ => return Err(GameError::InvalidPhase.into()),
    }
    for i in 0..game.player_count as usize { game.player_bets[i] = 0; }
    game.current_bet = 0;
    let first = find_next_active_player(game, game.dealer_index as usize);
    game.current_player = first as u8;
    game.last_raiser = first as u8;
    Ok(())
}

/// Derive PDA seeds from AccountType enum — mirrors TS client.
fn derive_seeds(account_type: &AccountType) -> Vec<Vec<u8>> {
    match account_type {
        AccountType::Game { game_id } => {
            vec![GAME_SEED.to_vec(), game_id.to_le_bytes().to_vec()]
        }
        AccountType::PlayerHand { game_id, seat_index } => {
            vec![HAND_SEED.to_vec(), game_id.to_le_bytes().to_vec(), vec![*seat_index]]
        }
    }
}

// ─── Account structs ─────────────────────────────────────────────────────────

#[account]
pub struct GameState {
    pub game_id: u64,
    pub table_id: u64,
    pub player_count: u8,
    pub wager_tier: u64,
    pub phase: GamePhase,
    pub pot: u64,
    pub current_bet: u64,
    pub dealer_index: u8,
    pub current_player: u8,
    pub last_raiser: u8,
    pub deck: [u8; 52],
    pub players: [Pubkey; 6],       // flat arrays instead of embedded PlayerState
    pub player_status: [u8; 6],
    pub player_bets: [u64; 6],
    pub community_cards: [u8; 5],
    pub community_count: u8,
    pub winner_index: u8,
    pub authority: Pubkey,
    pub bump: u8,
    pub created_at: i64,
    pub last_action_at: i64,
}

/// Separate account for each player's hole cards — lives in its own PDA
/// so TEE permissions can restrict reads per-player.
#[account]
pub struct PlayerHand {
    pub game_id: u64,    // 8
    pub player: Pubkey,  // 32
    pub hand: [u8; 2],   // 2  (255 = not yet dealt)
    pub bump: u8,        // 1
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum GamePhase { Waiting, Preflop, Flop, Turn, River, Showdown, Complete }

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PlayerStatus { Empty = 0, Active = 1, Folded = 2, AllIn = 3 }

#[derive(Clone, Copy)]
pub enum ActionType { Fold, Check, Call, Raise, AllIn }

impl ActionType {
    pub fn from_u8(val: u8) -> Result<Self> {
        match val {
            0 => Ok(Self::Fold), 1 => Ok(Self::Check), 2 => Ok(Self::Call),
            3 => Ok(Self::Raise), 4 => Ok(Self::AllIn),
            _ => Err(GameError::InvalidAction.into()),
        }
    }
}

/// Enum for generic delegation — identifies which PDA type to delegate.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AccountType {
    Game { game_id: u64 },
    PlayerHand { game_id: u64, seat_index: u8 },
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct GameFinished {
    pub game_id: u64,
    pub winner_index: u8,
    pub winner_pubkey: Pubkey,
    pub pot: u64,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum GameError {
    #[msg("Invalid player count (must be 2-6)")] InvalidPlayerCount,
    #[msg("Invalid game phase for this action")] InvalidPhase,
    #[msg("Player is not active")] PlayerNotActive,
    #[msg("Cannot check when there is an outstanding bet")] CannotCheck,
    #[msg("Raise must be greater than current bet")] RaiseTooSmall,
    #[msg("Invalid action type")] InvalidAction,
    #[msg("Math overflow")] MathOverflow,
    #[msg("Unauthorized")] Unauthorized,
}

// ─── Instruction contexts ────────────────────────────────────────────────────

/// Initialise GameState + 6 PlayerHand PDAs on L1 before delegation.
/// Seeds use game_id (NOT table_id) for uniqueness.
#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + GameState::MAX_SIZE,
              seeds = [GAME_SEED, game_id.to_le_bytes().as_ref()], bump)]
    pub game: Account<'info, GameState>,
    // Six PlayerHand PDAs — seeded by [HAND_SEED, game_id, seat_index]
    #[account(init, payer = authority, space = 8 + PlayerHand::MAX_SIZE,
              seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[0u8]], bump)]
    pub hand0: Account<'info, PlayerHand>,
    #[account(init, payer = authority, space = 8 + PlayerHand::MAX_SIZE,
              seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[1u8]], bump)]
    pub hand1: Account<'info, PlayerHand>,
    #[account(init, payer = authority, space = 8 + PlayerHand::MAX_SIZE,
              seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[2u8]], bump)]
    pub hand2: Account<'info, PlayerHand>,
    #[account(init, payer = authority, space = 8 + PlayerHand::MAX_SIZE,
              seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[3u8]], bump)]
    pub hand3: Account<'info, PlayerHand>,
    #[account(init, payer = authority, space = 8 + PlayerHand::MAX_SIZE,
              seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[4u8]], bump)]
    pub hand4: Account<'info, PlayerHand>,
    #[account(init, payer = authority, space = 8 + PlayerHand::MAX_SIZE,
              seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[5u8]], bump)]
    pub hand5: Account<'info, PlayerHand>,
    pub system_program: Program<'info, System>,
}

/// Generic delegate context — works for BOTH GameState and PlayerHand PDAs.
/// Uses `AccountType` enum to derive seeds dynamically.
/// The `del` attribute marks the PDA for delegation.
#[delegate]
#[derive(Accounts)]
pub struct DelegatePda<'info> {
    /// CHECK: The PDA to delegate (either GameState or PlayerHand)
    #[account(mut, del)]
    pub pda: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: TEE validator — optional, validated by delegation program
    pub validator: Option<AccountInfo<'info>>,
}

/// Create TEE permission for a PDA — uses on-chain CPI to MagicBlock's
/// permission program. NOT done from TypeScript (permissions must be created
/// by the PDA's owner program via CPI with invoke_signed).
#[derive(Accounts)]
pub struct CreatePermission<'info> {
    /// CHECK: Validated via permission program CPI
    pub permissioned_account: UncheckedAccount<'info>,
    /// CHECK: Permission PDA — checked by the permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: MagicBlock permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// VRF shuffle request — includes all 6 hand PDAs in accounts_metas so
/// the callback can write hole cards to each one.
#[vrf]
#[derive(Accounts)]
#[instruction(client_seed: u8)]
pub struct RequestShuffle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref()],
              bump = game.bump, has_one = authority @ GameError::Unauthorized)]
    pub game: Account<'info, GameState>,
    pub authority: Signer<'info>,
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
    // All 6 hand PDAs — passed in VRF accounts_metas for the callback
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[0u8]], bump)]
    pub hand0: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[1u8]], bump)]
    pub hand1: Account<'info, PlayerHand>,
    // ... hand2-hand5 same pattern
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[2u8]], bump)]
    pub hand2: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[3u8]], bump)]
    pub hand3: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[4u8]], bump)]
    pub hand4: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[5u8]], bump)]
    pub hand5: Account<'info, PlayerHand>,
}

/// VRF callback — invoked by oracle CPI. vrf_program_identity signer check
/// prevents anyone from calling with crafted randomness.
#[derive(Accounts)]
pub struct CallbackShuffle<'info> {
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut)]
    pub game: Account<'info, GameState>,
    // All 6 hand PDAs — mut for dealing hole cards
    #[account(mut, seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[0u8]], bump)]
    pub hand0: Account<'info, PlayerHand>,
    #[account(mut, seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[1u8]], bump)]
    pub hand1: Account<'info, PlayerHand>,
    #[account(mut, seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[2u8]], bump)]
    pub hand2: Account<'info, PlayerHand>,
    #[account(mut, seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[3u8]], bump)]
    pub hand3: Account<'info, PlayerHand>,
    #[account(mut, seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[4u8]], bump)]
    pub hand4: Account<'info, PlayerHand>,
    #[account(mut, seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[5u8]], bump)]
    pub hand5: Account<'info, PlayerHand>,
}

#[derive(Accounts)]
pub struct PlayerAction<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref()],
              bump = game.bump, has_one = authority @ GameError::Unauthorized)]
    pub game: Account<'info, GameState>,
}

/// Showdown context — includes #[commit] for commit_and_undelegate,
/// all 6 hand PDAs for reading hole cards, 6 permission PDAs for revealing,
/// and the permission program for UpdatePermission CPI.
#[commit]
#[derive(Accounts)]
pub struct Showdown<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref()],
              bump = game.bump)]
    pub game: Account<'info, GameState>,
    // All 6 PlayerHand PDAs — needed to read hole cards + update permissions
    #[account(mut, seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[0u8]], bump)]
    pub hand0: Account<'info, PlayerHand>,
    #[account(mut, seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[1u8]], bump)]
    pub hand1: Account<'info, PlayerHand>,
    #[account(mut, seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[2u8]], bump)]
    pub hand2: Account<'info, PlayerHand>,
    #[account(mut, seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[3u8]], bump)]
    pub hand3: Account<'info, PlayerHand>,
    #[account(mut, seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[4u8]], bump)]
    pub hand4: Account<'info, PlayerHand>,
    #[account(mut, seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[5u8]], bump)]
    pub hand5: Account<'info, PlayerHand>,
    // 6 Permission PDAs — set to public at showdown
    /// CHECK: Permission PDA for hand0-5 — validated by permission program
    #[account(mut)] pub permission_hand0: UncheckedAccount<'info>,
    #[account(mut)] pub permission_hand1: UncheckedAccount<'info>,
    #[account(mut)] pub permission_hand2: UncheckedAccount<'info>,
    #[account(mut)] pub permission_hand3: UncheckedAccount<'info>,
    #[account(mut)] pub permission_hand4: UncheckedAccount<'info>,
    #[account(mut)] pub permission_hand5: UncheckedAccount<'info>,
    /// CHECK: MagicBlock permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
}
```

### 3.2 Hand Evaluator Module

**File: `programs/agent-poker-game/src/hand_eval.rs`**

The hand evaluator is fully implemented with:
- `card_value(card: u8) -> u8` — value = card % 13
- `card_suit(card: u8) -> u8` — suit = card / 13
- `evaluate_hand(cards: &[u8; 7]) -> u32` — 7-card evaluator, returns rank
- `evaluate_winner(players: &[(u8, [u8; 2])], community: &[u8; 5]) -> usize`

Rank format: `category << 20 | tiebreaker_bits` (category in top bits for ordering).

Key design decisions:
- Uses `category << 20` (NOT `<< 28`) — 20 bits for tiebreaker, 12 for category
- Straight flush detection: builds flush-only value_counts, checks for straight within
- Full house detection: handles `trips.len() >= 2` (two sets of trips → pick best)
- `encode_top_5` for flush/high-card tiebreakers (4 bits per card, 5 cards)
- Kicker logic: `find_best_kicker` excludes the main hand values
- Ace-low straight (wheel): returns high = 3 (the 5-high card index)
- 15 unit tests covering all 9 hand categories + tiebreakers

```rust
// Simplified key function — see actual file for full implementation
pub fn evaluate_hand(cards: &[u8; 7]) -> u32 {
    // ... value/suit counting ...
    // Check (in priority order):
    // 1. Straight flush (9 << 20)
    // 2. Four of a kind (8 << 20)
    // 3. Full house      (7 << 20)
    // 4. Flush           (6 << 20)
    // 5. Straight        (5 << 20)
    // 6. Three of a kind (4 << 20)
    // 7. Two pair        (3 << 20)
    // 8. One pair        (2 << 20)
    // 9. High card       (1 << 20)
}

pub fn evaluate_winner(players: &[(u8, [u8; 2])], community: &[u8; 5]) -> usize {
    // Skips Empty (0) and Folded (2) players
    // Builds 7-card hand from hole cards + community
    // Returns index of player with highest evaluate_hand() rank
}
```

### 3.3 PER Permission Setup (On-Chain via CPI)

> **IMPORTANT**: Permissions are created **on-chain via CPI** using
> `CreatePermissionCpiBuilder` / `UpdatePermissionCpiBuilder`, NOT from
> TypeScript. The PDA's owner program must sign the CPI with `invoke_signed`.
> This is the pattern used by MagicBlock's rock-paper-scissors example.

The game program's `create_permission` instruction handles permission creation
for both `GameState` and `PlayerHand` PDAs. The orchestrator calls this
instruction from TypeScript, but the actual permission CPI is executed on-chain.

The orchestrator's TypeScript role for PER is:
1. Call `create_permission` on-chain for each of the 7 PDAs (1 game + 6 hands)
2. Derive permission PDAs using `permissionPdaFromAccount()`
3. Delegate permissions to TEE validator via `createDelegatePermissionInstruction`
4. Get auth token via `getAuthToken()` for TEE connection
5. Wait for permissions to be active via `waitUntilPermissionActive`

At showdown, permissions are updated on-chain by the `showdown` instruction
which calls `UpdatePermissionCpiBuilder` with `members: None` (public) for
each PlayerHand PDA — this is how hands are revealed.

See Section 4.1 (orchestrator) for the full TypeScript flow.

---

## 4. Phase 3: Game Server

### 4.1 Turn Orchestrator

**File: `apps/game-server/src/orchestrator.ts`**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { getLLMAction } from "./llm-gateway";
import { SpectatorFeed } from "./spectator-feed";

// ---------------------------------------------------------------------------
// Dual-connection architecture (CRITICAL)
// ---------------------------------------------------------------------------
// Base Layer  → initialization, delegation, permission setup, L1 settlement
// TEE Ephemeral Rollup → all in-game txs: request_shuffle, player_action,
//                         showdown (includes commit + undelegate)
//
// IMPORTANT: Use TEE endpoint (tee.magicblock.app), NOT devnet.magicblock.app
// TEE provides privacy (PER) — devnet ER does NOT support PER.
// Each reader needs an auth token from getAuthToken().
// ---------------------------------------------------------------------------

const TEE_ENDPOINT = process.env.TEE_ENDPOINT ?? "https://tee.magicblock.app";
const TEE_WS_ENDPOINT = process.env.TEE_WS_ENDPOINT ?? "wss://tee.magicblock.app";
const TEE_VALIDATOR = new PublicKey("FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA");

interface GameConfig {
  tableId: number;
  players: { agent: PublicKey; template: string; displayName: string }[];
  wagerTier: number;
}

export class GameOrchestrator {
  /** Program bound to the BASE LAYER — used for L1 instructions */
  private pokerProgram: Program;
  /** Program bound to the EPHEMERAL ROLLUP — used after delegation */
  private ephemeralPokerProgram: Program;

  constructor(
    private baseConnection: Connection,
    pokerIdl: anchor.Idl,
    pokerProgramId: PublicKey,
    private escrowProgram: Program,
    private bettingProgram: Program,
    private gameServerKeypair: Keypair,
    private spectatorFeed: SpectatorFeed
  ) {
    const wallet = new Wallet(gameServerKeypair);

    // Base layer provider (Solana devnet / mainnet)
    const baseProvider = new AnchorProvider(baseConnection, wallet, {
      commitment: "confirmed",
    });
    this.pokerProgram = new Program(pokerIdl, baseProvider);

    // TEE provider is created per-game after getting auth token (see runGame)
    this.ephemeralPokerProgram = null as any; // set in runGame
  }

  /** Create an authenticated TEE connection using getAuthToken() */
  private async createTeeProvider(wallet: Wallet): Promise<{ provider: AnchorProvider; token: string }> {
    const { getAuthToken } = await import("@magicblock-labs/ephemeral-rollups-sdk");
    const nacl = await import("tweetnacl");

    const token = await getAuthToken(
      TEE_ENDPOINT,
      this.gameServerKeypair.publicKey,
      (message: Uint8Array) =>
        Promise.resolve(nacl.sign.detached(message, this.gameServerKeypair.secretKey))
    );

    const teeConnection = new Connection(`${TEE_ENDPOINT}?token=${token}`, {
      wsEndpoint: `${TEE_WS_ENDPOINT}?token=${token}`,
      commitment: "confirmed",
    });
    const provider = new AnchorProvider(teeConnection, wallet, {
      commitment: "confirmed",
    });
    return { provider, token };
  }

  async runGame(config: GameConfig): Promise<void> {
    const { tableId, players } = config;
    const gameId = Date.now(); // unique game ID
    const gameStatePda = this.deriveGamePda(gameId);
    const playerHandPdas = players.map((_, i) => this.deriveHandPda(gameId, i));

    // ------------------------------------------------------------------
    // Step 1: Create GameState + 6 PlayerHand PDAs on BASE LAYER
    // ------------------------------------------------------------------
    await this.pokerProgram.methods
      .createGame(
        new anchor.BN(gameId),
        new anchor.BN(tableId),
        players.map((p) => p.agent),
        new anchor.BN(config.wagerTier)
      )
      .rpc({ skipPreflight: false });

    // ------------------------------------------------------------------
    // Step 2: Create TEE permissions for ALL 7 PDAs (on-chain CPI)
    // ------------------------------------------------------------------
    const { permissionPdaFromAccount, createDelegatePermissionInstruction, waitUntilPermissionActive } =
      await import("@magicblock-labs/ephemeral-rollups-sdk");

    // Create permission for GameState
    await this.pokerProgram.methods
      .createPermission({ game: { gameId: new anchor.BN(gameId) } }, null)
      .accounts({ permissionedAccount: gameStatePda })
      .rpc();

    // Create permissions for each PlayerHand with per-agent read access
    for (let i = 0; i < players.length; i++) {
      await this.pokerProgram.methods
        .createPermission(
          { playerHand: { gameId: new anchor.BN(gameId), seatIndex: i } },
          [{ pubkey: players[i].agent, flags: 0x01 | 0x04 | 0x08 }]
        )
        .accounts({ permissionedAccount: playerHandPdas[i] })
        .rpc();
    }

    // ------------------------------------------------------------------
    // Step 3: Delegate ALL 7 PDAs to TEE validator (BASE LAYER txs)
    // ------------------------------------------------------------------
    const allPdas = [gameStatePda, ...playerHandPdas];
    const accountTypes = [
      { game: { gameId: new anchor.BN(gameId) } },
      ...players.map((_, i) => ({ playerHand: { gameId: new anchor.BN(gameId), seatIndex: i } })),
    ];

    for (let i = 0; i < allPdas.length; i++) {
      await this.pokerProgram.methods
        .delegatePda(accountTypes[i])
        .accounts({ pda: allPdas[i], validator: TEE_VALIDATOR })
        .rpc({ skipPreflight: false });
    }

    // Delegate permission PDAs to TEE validator
    for (const pda of allPdas) {
      const permPda = permissionPdaFromAccount(pda);
      const ix = createDelegatePermissionInstruction(permPda, this.gameServerKeypair.publicKey, TEE_VALIDATOR);
      await this.baseConnection.sendTransaction(
        new anchor.web3.Transaction().add(ix),
        [this.gameServerKeypair]
      );
    }

    // Wait for all permissions to be active on TEE
    for (const pda of allPdas) {
      const permPda = permissionPdaFromAccount(pda);
      await waitUntilPermissionActive(this.baseConnection, permPda);
    }

    // ------------------------------------------------------------------
    // Step 4: Create authenticated TEE connection
    // ------------------------------------------------------------------
    const wallet = new Wallet(this.gameServerKeypair);
    const { provider: teeProvider } = await this.createTeeProvider(wallet);
    this.ephemeralPokerProgram = new Program(this.pokerProgram.idl, teeProvider);

    // Wait for delegation to propagate (~1-2 seconds)
    await sleep(2000);

    // ------------------------------------------------------------------
    // Step 3: Request VRF shuffle — sent via EPHEMERAL ROLLUP connection
    // Use DEFAULT_EPHEMERAL_QUEUE (set in the RequestShuffle account ctx)
    // skipPreflight: true is standard for ER transactions
    // ------------------------------------------------------------------
    const clientSeed = Math.floor(Math.random() * 255);
    await this.ephemeralPokerProgram.methods
      .requestShuffle(clientSeed)
      .rpc({ skipPreflight: true });

    // ------------------------------------------------------------------
    // Step 4: Poll ER until VRF callback fires and deck is shuffled
    // The callback_shuffle instruction is invoked by the VRF oracle CPI,
    // so we just poll until game.phase advances past the initial state.
    // ------------------------------------------------------------------
    await this.waitForShuffle(gameStatePda);

    // Broadcast game start
    this.spectatorFeed.broadcast(tableId, {
      type: "game_started",
      players: players.map((p) => ({
        displayName: p.displayName,
        template: p.template,
      })),
    });

    // ------------------------------------------------------------------
    // Step 5: Game loop — ALL actions go through EPHEMERAL ROLLUP
    // ------------------------------------------------------------------
    let gameState = await this.fetchGameState(gameStatePda);

    while (gameState.phase !== "Finished") {
      const activeIdx = gameState.activePlayer;
      const activePlayer = players[activeIdx];
      const playerState = gameState.players[activeIdx];

      if (playerState.status !== "Active") {
        gameState = await this.fetchGameState(gameStatePda);
        continue;
      }

      this.spectatorFeed.broadcast(tableId, {
        type: "thinking",
        player: activePlayer.displayName,
        template: activePlayer.template,
      });

      const visibleState = {
        phase: gameState.phase,
        myHand: gameState.players[activeIdx].hand,
        communityCards: gameState.communityCards.filter((c: number) => c !== 255),
        pot: gameState.pot,
        currentBet: gameState.currentBet,
        myChips: playerState.chips,
        myCurrentBet: playerState.currentRoundBet,
        opponents: gameState.players
          .filter((_: any, i: number) => i !== activeIdx)
          .map((p: any) => ({
            status: p.status,
            chips: p.chips,
            lastAction: p.lastAction,
            currentRoundBet: p.currentRoundBet,
          })),
      };

      const decision = await getLLMAction(activePlayer.template, visibleState);

      // Submit action via EPHEMERAL ROLLUP
      await this.ephemeralPokerProgram.methods
        .playerAction(decision.action)
        .rpc({ skipPreflight: true });

      this.spectatorFeed.broadcast(tableId, {
        type: "action",
        player: activePlayer.displayName,
        action: decision.action,
        reasoning: decision.reasoning,
        gameState: this.sanitizeForSpectators(gameState),
      });

      await sleep(2500);

      // Fetch updated state from EPHEMERAL ROLLUP connection
      gameState = await this.fetchGameState(gameStatePda);

      if (gameState.phase === "Showdown") {
        // showdown instruction: reveals hands, evaluates winner, commits + undelegates
        // This single instruction replaces the old separate showdown + finish_game
        await this.ephemeralPokerProgram.methods.showdown().rpc({ skipPreflight: true });
        gameState = await this.fetchGameState(gameStatePda);
      }
    }

    this.spectatorFeed.broadcast(tableId, {
      type: "showdown",
      winner: gameState.winnerIndex,
      pot: gameState.pot,
    });

    await this.settleOnL1(tableId, gameState);
  }

  private async settleOnL1(tableId: number, gameState: any) {
    const winnerIdx = gameState.winnerIndex;

    // ------------------------------------------------------------------
    // showdown already committed + undelegated the game account back to L1.
    // No separate finish_game instruction needed.
    // Allow time for state to propagate back to L1 before settling.
    // ------------------------------------------------------------------
    await sleep(3000);

    // Settle escrow and betting on BASE LAYER (L1 programs)
    await this.escrowProgram.methods.settleTable(winnerIdx).rpc();
    await this.bettingProgram.methods.settlePool(winnerIdx).rpc();

    this.spectatorFeed.broadcast(tableId, {
      type: "settled",
      winnerIndex: winnerIdx,
    });
  }

  /** Fetch game state from the ER connection (delegated account lives there) */
  private async fetchGameState(gameStatePda: PublicKey): Promise<any> {
    return this.ephemeralPokerProgram.account.gameState.fetch(gameStatePda);
  }

  /** Poll until the VRF callback has fired (deck[0] changes from 0) */
  private async waitForShuffle(gameStatePda: PublicKey, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.fetchGameState(gameStatePda);
      // After shuffle, players have non-255 cards in their hand
      if (state.players[0].hand[0] !== 255) return;
      await sleep(500);
    }
    throw new Error("VRF shuffle timed out after 30s");
  }

  private sanitizeForSpectators(gameState: any) {
    return {
      phase: gameState.phase,
      pot: gameState.pot,
      currentBet: gameState.currentBet,
      communityCards: gameState.communityCards.filter((c: number) => c !== 255),
      players: gameState.players.map((p: any) => ({
        status: p.status,
        chips: p.chips,
        lastAction: p.lastAction,
        currentRoundBet: p.currentRoundBet,
        // NO hand data until showdown
      })),
    };
  }

  private findWinnerIndex(gameState: any): number {
    const active = gameState.players
      .map((p: any, i: number) => ({ ...p, index: i }))
      .filter((p: any) => p.status === "Active" || p.status === "AllIn");
    return active[0]?.index ?? 0;
  }

  private deriveGamePda(gameId: number): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("poker_game"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(gameId)]).buffer)),
      ],
      this.pokerProgram.programId
    );
    return pda;
  }

  private deriveHandPda(gameId: number, seatIndex: number): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_hand"),
        Buffer.from(new Uint8Array(new BigUint64Array([BigInt(gameId)]).buffer)),
        Buffer.from([seatIndex]),
      ],
      this.pokerProgram.programId
    );
    return pda;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### 4.2 LLM Gateway

**File: `apps/game-server/src/llm-gateway.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TEMPLATES_DIR = join(__dirname, "templates");

const templateCache = new Map<string, string>();

function loadTemplate(name: string): string {
  if (!templateCache.has(name)) {
    const path = join(TEMPLATES_DIR, `${name}.txt`);
    templateCache.set(name, readFileSync(path, "utf-8"));
  }
  return templateCache.get(name)!;
}

interface VisibleState {
  phase: string;
  myHand: number[];
  communityCards: number[];
  pot: number;
  currentBet: number;
  myChips: number;
  myCurrentBet: number;
  opponents: {
    status: string;
    chips: number;
    lastAction: string;
    currentRoundBet: number;
  }[];
}

interface LLMDecision {
  action: { type: string; amount?: number };
  reasoning: string;
}

const CARD_VALUES = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const CARD_SUITS = ["♥", "♦", "♣", "♠"];

function formatCard(cardIndex: number): string {
  if (cardIndex === 255) return "??";
  const value = CARD_VALUES[cardIndex % 13];
  const suit = CARD_SUITS[Math.floor(cardIndex / 13)];
  return `${value}${suit}`;
}

function getLegalActions(state: VisibleState): string {
  const actions: string[] = ["fold"];
  const toCall = state.currentBet - state.myCurrentBet;

  if (toCall === 0) {
    actions.push("check");
  } else {
    actions.push(`call (${toCall} chips)`);
  }

  if (state.myChips > toCall) {
    const minRaise = state.currentBet; // simplified
    actions.push(`raise (min: ${minRaise})`);
  }

  actions.push(`allin (${state.myChips} chips)`);

  return actions.join(", ");
}

export async function getLLMAction(template: string, state: VisibleState): Promise<LLMDecision> {
  const systemPrompt = loadTemplate(template);

  const userPrompt = `Current game state:
- Phase: ${state.phase}
- Your Hand: ${state.myHand.map(formatCard).join(" ")}
- Community Cards: ${state.communityCards.length > 0 ? state.communityCards.map(formatCard).join(" ") : "None (preflop)"}
- Pot: ${state.pot} chips
- Current Bet: ${state.currentBet} chips
- Your Chips: ${state.myChips}
- Your Current Bet This Round: ${state.myCurrentBet}

Opponents:
${state.opponents.map((o, i) => `  Seat ${i + 1}: ${o.status} | ${o.chips} chips | last: ${o.lastAction} | bet: ${o.currentRoundBet}`).join("\n")}

Legal actions: ${getLegalActions(state)}

Respond ONLY with JSON (no markdown):
{"action": "fold|check|call|raise|allin", "raise_amount": <number or null>, "reasoning": "<1-2 sentences>"}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const parsed = JSON.parse(text);
    return {
      action: {
        type: parsed.action,
        amount: parsed.raise_amount ?? undefined,
      },
      reasoning: parsed.reasoning ?? "",
    };
  } catch {
    // Fallback: if LLM returns invalid JSON, fold
    return { action: { type: "fold" }, reasoning: "Failed to parse response" };
  }
}
```

### 4.3 Agent Templates

**File: `apps/game-server/src/templates/shark.txt`**

```
You are a tight-aggressive (TAG) poker AI agent. Your strategy:

PREFLOP:
- Play only the top 20% of hands: pairs 77+, suited broadways, ATo+, KQo
- Always raise when entering a pot (never limp)
- 3-bet with AA, KK, QQ, AKs

POSTFLOP:
- Bet aggressively when you have top pair or better
- C-bet 60-70% of flops as the preflop raiser
- Fold to significant resistance when you have weak holdings
- Value bet thinly on the river with strong hands

GENERAL:
- Rarely bluff (max 15% of bets)
- Position-aware: tighter from early position, wider from late
- Patient and disciplined
- When in doubt, fold marginal hands

Always respond with valid JSON only.
```

**File: `apps/game-server/src/templates/maniac.txt`**

```
You are a loose-aggressive (LAG) poker AI agent. Your strategy:

PREFLOP:
- Play 40-50% of hands. Enter with raises, almost never limp.
- 3-bet aggressively with a wide range including suited connectors
- Apply pressure with large preflop raises

POSTFLOP:
- Bet frequently — c-bet 80%+ of flops
- Double and triple barrel with air to force folds
- Bluff roughly 40% of the time
- Make large overbets to put opponents in tough spots
- Semi-bluff aggressively with draws

GENERAL:
- Be unpredictable. Mix in unusual plays.
- Apply maximum pressure at all times
- Don't fear losing chips — aggression wins over time
- If you sense weakness, attack with a raise

Always respond with valid JSON only.
```

**File: `apps/game-server/src/templates/rock.txt`**

```
You are an ultra-tight (Nit) poker AI agent. Your strategy:

PREFLOP:
- Play ONLY premium hands (top 8%): AA, KK, QQ, JJ, TT, AKs, AKo, AQs
- Fold everything else preflop. No exceptions.
- When you play, always raise 3-4x the big blind.

POSTFLOP:
- Only continue with top pair top kicker or better
- Bet for value when you have strong hands
- Fold to aggression unless you have the nuts or near-nuts
- Never bluff. Your bets always mean strength.

GENERAL:
- Patience is your weapon. Wait for premium spots.
- Minimize losses by avoiding marginal situations
- Let other players eliminate each other
- Only put chips at risk with strong hands

Always respond with valid JSON only.
```

**File: `game-server/src/templates/fox.txt`**

```
You are an adaptive poker AI agent. Your strategy evolves based on opponents.

OBSERVATION:
- Track opponent actions across hands (who raises often, who folds to pressure)
- Categorize opponents: tight, loose, aggressive, passive
- Adjust your play based on the table dynamic

ADAPTATION RULES:
- Against tight players: steal their blinds, bluff more, attack their folds
- Against loose players: tighten up, value bet more, trap with slow-plays
- Against aggressive players: let them bluff into your strong hands
- Against passive players: bet for value thinly, don't bluff

PREFLOP:
- Start tight (top 25%) and widen or tighten based on table
- Position-aware: steal from late position when blinds are tight

POSTFLOP:
- Vary your play to avoid being predictable
- Mix bet sizes to confuse opponents
- Use game theory: balance bluffs with value bets

GENERAL:
- Information is your edge. Every action reveals something.
- Be deceptive — sometimes slow-play, sometimes fast-play the same hand
- Think about what opponents think you have

Always respond with valid JSON only.
```

### 4.4 Matchmaker

**File: `game-server/src/matchmaker.ts`**

```typescript
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { GameOrchestrator } from "./orchestrator";
import { SpectatorFeed } from "./spectator-feed";

interface QueuedAgent {
  agentPda: PublicKey;
  ownerPubkey: PublicKey;
  template: string;
  displayName: string;
  wagerTier: number;
  queuedAt: number;
}

export class Matchmaker {
  private queues: Map<number, QueuedAgent[]> = new Map();
  private tableIdCounter = 0;
  private readonly WAGER_TIERS = [
    0.1 * 1e9, // 0.1 SOL (~$1)
    0.3 * 1e9, // 0.3 SOL (~$3)
    0.5 * 1e9, // 0.5 SOL (~$5)
    1.0 * 1e9, // 1.0 SOL (~$10)
  ];

  constructor(
    private orchestrator: GameOrchestrator,
    private escrowProgram: Program,
    private bettingProgram: Program,
    private spectatorFeed: SpectatorFeed
  ) {
    // Initialize queues for each tier
    this.WAGER_TIERS.forEach((tier) => this.queues.set(tier, []));
  }

  addToQueue(agent: QueuedAgent): void {
    const queue = this.queues.get(agent.wagerTier);
    if (!queue) throw new Error(`Invalid wager tier: ${agent.wagerTier}`);

    // Prevent duplicate entries
    if (queue.some((a) => a.agentPda.equals(agent.agentPda))) return;

    queue.push(agent);

    // Broadcast queue update
    this.spectatorFeed.broadcastGlobal({
      type: "queue_update",
      wagerTier: agent.wagerTier,
      queueSize: queue.length,
    });

    // Check if we can start a game
    if (queue.length >= 6) {
      this.startTable(agent.wagerTier);
    }
  }

  private async startTable(wagerTier: number): Promise<void> {
    const queue = this.queues.get(wagerTier)!;
    const players = queue.splice(0, 6); // Take first 6

    const tableId = ++this.tableIdCounter;

    // 1. Create table escrow on L1
    await this.escrowProgram.methods.createTable(tableId, wagerTier).rpc();

    // 2. Join all agents to table (escrow wagers)
    for (const player of players) {
      await this.escrowProgram.methods.joinTable().accounts({ agent: player.agentPda }).rpc();
    }

    // 3. Create spectator betting pool
    await this.bettingProgram.methods
      .createPool(
        tableId,
        players.map((p) => p.agentPda)
      )
      .rpc();

    // 4. Announce table — open for spectator bets
    this.spectatorFeed.broadcastGlobal({
      type: "table_created",
      tableId,
      wagerTier,
      players: players.map((p) => ({
        displayName: p.displayName,
        template: p.template,
      })),
      bettingEndsAt: Date.now() + 60_000, // 60 seconds
    });

    // 5. Wait for spectator betting window
    await sleep(60_000);

    // 6. Lock betting pool
    await this.bettingProgram.methods.lockPool().rpc();

    // 7. Mark game as in progress
    await this.escrowProgram.methods.startGame().rpc();

    // 8. Run the game
    await this.orchestrator.runGame({
      tableId,
      players: players.map((p) => ({
        agent: p.agentPda,
        template: p.template,
        displayName: p.displayName,
      })),
      wagerTier,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### 4.5 Spectator WebSocket Feed

**File: `game-server/src/ws-feed.ts`**

```typescript
import { FastifyInstance } from "fastify";
import { WebSocket } from "ws";

interface ConnectedClient {
  socket: WebSocket;
  tableIds: Set<number>;
}

export class SpectatorFeed {
  private clients: Map<string, ConnectedClient> = new Map();
  private clientIdCounter = 0;

  register(fastify: FastifyInstance): void {
    fastify.get("/ws", { websocket: true }, (socket, req) => {
      const clientId = String(++this.clientIdCounter);
      this.clients.set(clientId, { socket, tableIds: new Set() });

      socket.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          const client = this.clients.get(clientId);
          if (!client) return;

          if (msg.type === "watch_table") {
            client.tableIds.add(msg.tableId);
          } else if (msg.type === "leave_table") {
            client.tableIds.delete(msg.tableId);
          }
        } catch {}
      });

      socket.on("close", () => {
        this.clients.delete(clientId);
      });
    });
  }

  broadcast(tableId: number, data: any): void {
    const message = JSON.stringify({ type: "game_event", tableId, ...data });
    for (const client of this.clients.values()) {
      if (client.tableIds.has(tableId) && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(message);
      }
    }
  }

  broadcastGlobal(data: any): void {
    const message = JSON.stringify({ type: "global_event", ...data });
    for (const client of this.clients.values()) {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(message);
      }
    }
  }
}
```

### 4.6 Server Entry Point

**File: `game-server/src/server.ts`**

```typescript
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { Connection, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { SpectatorFeed } from "./ws-feed";
import { GameOrchestrator } from "./orchestrator";
import { Matchmaker } from "./matchmaker";
import { Type } from "@sinclair/typebox";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const fastify = Fastify({ logger: true });

  // Register plugins
  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);

  // Solana connection
  const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com");

  // Game server keypair (authority for settle/actions)
  const gameServerKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(process.env.GAME_SERVER_KEYPAIR!))
  );

  const wallet = new Wallet(gameServerKeypair);
  const provider = new AnchorProvider(connection, wallet, {});

  // Load program IDLs (generated by Anchor build)
  // const pokerProgram = new Program(pokerIdl, provider);
  // const escrowProgram = new Program(escrowIdl, provider);
  // const bettingProgram = new Program(bettingIdl, provider);

  // Initialize WebSocket feed and register route
  const spectatorFeed = new SpectatorFeed();
  spectatorFeed.register(fastify);

  // const orchestrator = new GameOrchestrator(...);
  // const matchmaker = new Matchmaker(...);

  // --- API Routes ---

  const QueueBody = Type.Object({
    agentPda: Type.String(),
    ownerPubkey: Type.String(),
    template: Type.String(),
    displayName: Type.String(),
    wagerTier: Type.Number(),
  });

  fastify.post("/api/queue", { schema: { body: QueueBody } }, async (req, reply) => {
    const { agentPda, ownerPubkey, template, displayName, wagerTier } = req.body as any;
    // matchmaker.addToQueue({ ... });
    return { success: true };
  });

  fastify.get("/api/tables", async (req, reply) => {
    return { tables: [] };
  });

  fastify.get("/api/tables/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    return { table: null };
  });

  fastify.get("/api/leaderboard", async (req, reply) => {
    return { agents: [] };
  });

  fastify.get("/api/agent/:pubkey", async (req, reply) => {
    const { pubkey } = req.params as { pubkey: string };
    return { agent: null };
  });

  // Start server
  const PORT = Number(process.env.PORT) || 3001;
  await fastify.listen({ port: PORT, host: "0.0.0.0" });
  fastify.log.info(`AgentPoker game server running on port ${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

---

## 5. Phase 4: Frontend

### 5.1 App Structure

```
app/src/
├── app/
│   ├── layout.tsx              # Root layout with providers
│   ├── page.tsx                # Landing page
│   ├── play/
│   │   ├── page.tsx            # Agent dashboard
│   │   └── create/
│   │       └── page.tsx        # Create agent flow
│   ├── tables/
│   │   ├── page.tsx            # Browse tables
│   │   └── [id]/
│   │       └── page.tsx        # Spectator view + betting
│   └── leaderboard/
│       └── page.tsx            # Top agents
├── components/
│   ├── poker/
│   │   ├── PokerTable.tsx      # Main table visualization
│   │   ├── PlayerSeat.tsx      # Individual player seat
│   │   ├── CommunityCards.tsx  # Center cards
│   │   ├── Card.tsx            # Single card component
│   │   ├── PotDisplay.tsx      # Pot amount
│   │   ├── ActionLog.tsx       # Agent action + reasoning feed
│   │   └── ThinkingBubble.tsx  # "Agent is thinking..." bubble
│   ├── betting/
│   │   ├── BettingPanel.tsx    # Place bets UI
│   │   └── BetStatus.tsx       # Current bet status
│   ├── agent/
│   │   ├── CreateAgentForm.tsx # Template picker + naming
│   │   ├── AgentCard.tsx       # Agent stats display
│   │   └── FundAgent.tsx       # Deposit/withdraw
│   ├── layout/
│   │   ├── Navbar.tsx
│   │   └── WalletButton.tsx
│   └── ui/                     # shadcn/ui components
├── hooks/
│   ├── useGameSocket.ts        # WebSocket hook for live game
│   ├── useAgent.ts             # Fetch agent data from chain
│   └── usePokerProgram.ts      # Anchor program hooks
└── lib/
    ├── solana.ts               # Connection, programs
    ├── constants.ts            # Program IDs, seeds
    └── poker-utils.ts          # Card formatting, hand names
```

### 5.2 Key Components

**File: `app/src/hooks/useGameSocket.ts`**

```typescript
"use client";

import { useEffect, useState, useCallback } from "react";
interface GameEvent {
  type: string;
  [key: string]: any;
}

export function useGameSocket(tableId: number | null) {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [gameState, setGameState] = useState<any>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);

  useEffect(() => {
    if (!tableId) return;

    const wsUrl = process.env.NEXT_PUBLIC_GAME_SERVER_WS_URL || "ws://localhost:3001/ws";
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "watch_table", tableId }));
    };

    ws.onmessage = (msg) => {
      try {
        const event: GameEvent = JSON.parse(msg.data);
        setEvents((prev) => [...prev.slice(-50), event]);

        switch (event.type) {
          case "game_started":
            setGameState({ phase: "preflop", players: event.players });
            break;
          case "action":
            setGameState(event.gameState);
            break;
          case "showdown":
            setGameState((prev: any) => ({
              ...prev,
              phase: "showdown",
              hands: event.hands,
              winner: event.winner,
            }));
            break;
          case "settled":
            setGameState((prev: any) => ({ ...prev, phase: "settled" }));
            break;
        }
      } catch {}
    };

    setSocket(ws);

    return () => {
      ws.send(JSON.stringify({ type: "leave_table", tableId }));
      ws.close();
    };
  }, [tableId]);

  return { gameState, events, socket };
}
```

**File: `app/src/components/poker/PokerTable.tsx`**

```tsx
"use client";

import * as motion from "motion/react";
import { PlayerSeat } from "./PlayerSeat";
import { CommunityCards } from "./CommunityCards";
import { PotDisplay } from "./PotDisplay";
import { ThinkingBubble } from "./ThinkingBubble";
import { ActionLog } from "./ActionLog";

interface PokerTableProps {
  gameState: any;
  events: any[];
}

// Seat positions around an oval table (CSS positions in %)
const SEAT_POSITIONS = [
  { top: "8%", left: "50%", transform: "translateX(-50%)" }, // top center
  { top: "25%", right: "5%" }, // top right
  { top: "65%", right: "5%" }, // bottom right
  { bottom: "8%", left: "50%", transform: "translateX(-50%)" }, // bottom center
  { top: "65%", left: "5%" }, // bottom left
  { top: "25%", left: "5%" }, // top left
];

export function PokerTable({ gameState, events }: PokerTableProps) {
  if (!gameState) {
    return (
      <div className="flex items-center justify-center h-[600px] bg-gray-900 rounded-2xl">
        <p className="text-gray-400">Waiting for game to start...</p>
      </div>
    );
  }

  const lastEvent = events[events.length - 1];
  const thinkingPlayer = lastEvent?.type === "thinking" ? lastEvent.player : null;

  return (
    <div className="relative w-full h-[600px] bg-green-900 rounded-[100px] border-8 border-amber-800 overflow-hidden">
      {/* Felt texture overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-green-800 to-green-950 opacity-80" />

      {/* Community cards */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <CommunityCards cards={gameState.communityCards || []} />
        <PotDisplay amount={gameState.pot} />
      </div>

      {/* Player seats */}
      {gameState.players?.map((player: any, i: number) => (
        <div key={i} className="absolute" style={SEAT_POSITIONS[i]}>
          <PlayerSeat
            player={player}
            isActive={i === gameState.activePlayer}
            isThinking={thinkingPlayer === player.displayName}
            showHand={gameState.phase === "showdown"}
          />
        </div>
      ))}

      {/* Thinking bubble */}
      <motion.AnimatePresence>
        {thinkingPlayer && <ThinkingBubble playerName={thinkingPlayer} />}
      </motion.AnimatePresence>

      {/* Action log */}
      <div className="absolute bottom-4 left-4 right-4">
        <ActionLog events={events.filter((e) => e.type === "action").slice(-5)} />
      </div>
    </div>
  );
}
```

---

## 6. Phase 5: Integration & Testing

### 6.1 Local Development Setup

```bash
# Terminal 1: Start local Solana validator
solana-test-validator --reset

# Terminal 2: Start local MagicBlock ER validator
RUST_LOG=info ephemeral-validator \
  --remotes "http://localhost:8899" \
  --remotes "ws://localhost:8900" \
  -l "127.0.0.1:7799"

# Terminal 3: Build and deploy programs
anchor build
anchor deploy

# Terminal 4: Start game server
cd game-server && npm run dev

# Terminal 5: Start frontend
cd app && npm run dev
```

### 6.2 Test Strategy

```
tests/
├── programs/
│   ├── agent.test.ts           # Create, fund, withdraw agents
│   ├── escrow.test.ts          # Table lifecycle, settle, refund
│   ├── betting.test.ts         # Pool, bets, settle, claim
│   └── poker.test.ts           # Full poker game on ER
├── integration/
│   ├── full-game.test.ts       # End-to-end game lifecycle
│   ├── matchmaker.test.ts      # Queue and table creation
│   └── llm-gateway.test.ts     # LLM response parsing
└── hand-eval/
    └── hand-eval.test.ts       # Poker hand evaluation correctness
```

**File: `tests/programs/agent.test.ts`**

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentPokerAgent } from "../target/types/agent_poker_agent";
import { expect } from "chai";

describe("agent-poker-agent", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.AgentPokerAgent as Program<AgentPokerAgent>;
  const owner = anchor.web3.Keypair.generate();

  before(async () => {
    // Airdrop SOL to owner
    const sig = await program.provider.connection.requestAirdrop(
      owner.publicKey,
      10 * anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(sig);
  });

  it("creates an agent", async () => {
    await program.methods
      .createAgent(0, "TestShark")
      .accounts({ owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const [agentPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), owner.publicKey.toBuffer()],
      program.programId
    );

    const agent = await program.account.agentAccount.fetch(agentPda);
    expect(agent.template).to.equal(0);
    expect(agent.displayName).to.equal("TestShark");
    expect(agent.totalGames.toNumber()).to.equal(0);
  });

  it("funds the agent vault", async () => {
    const amount = 5 * anchor.web3.LAMPORTS_PER_SOL;
    await program.methods
      .fundAgent(new anchor.BN(amount))
      .accounts({ owner: owner.publicKey })
      .signers([owner])
      .rpc();

    const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent_vault"), owner.publicKey.toBuffer()],
      program.programId
    );

    const balance = await program.provider.connection.getBalance(vaultPda);
    expect(balance).to.equal(amount);
  });

  it("withdraws from agent vault", async () => {
    const amount = 2 * anchor.web3.LAMPORTS_PER_SOL;
    await program.methods
      .withdraw(new anchor.BN(amount))
      .accounts({ owner: owner.publicKey })
      .signers([owner])
      .rpc();
  });

  it("rejects invalid template", async () => {
    const owner2 = anchor.web3.Keypair.generate();
    try {
      await program.methods
        .createAgent(5, "Bad")
        .accounts({ owner: owner2.publicKey })
        .signers([owner2])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidTemplate");
    }
  });
});
```

---

## 7. Complete TODO List

### Phase 0: Project Setup

- [x] **0.1** Initialize Anchor workspace with `anchor init`
- [x] **0.2** Create 4 program crates: `agent-poker-agent`, `agent-poker-escrow`, `agent-poker-betting`, `agent-poker-game`
- [x] **0.3** Add MagicBlock SDK dependencies to `agent-poker-game` (`ephemeral-rollups-sdk`, `ephemeral_vrf_sdk`)
- [x] **0.4** Initialize game-server Fastify project with dependencies (fastify, @fastify/websocket, @fastify/cors, @sinclair/typebox)
- [x] **0.5** Initialize Next.js frontend with Tailwind, wallet adapter, motion (motion.dev)
- [x] **0.6** Configure `Anchor.toml` for devnet
- [x] **0.7** Set up `.env` files for game server (RPC URL, keypair, Anthropic API key)
- [ ] **0.8** Install and configure local MagicBlock ephemeral validator for testing

---

### Phase 1: On-Chain Programs (L1)

#### 1A: Agent Program

- [x] **1A.1** Define `AgentAccount` struct with all fields (owner, template, display_name, vault, stats)
- [x] **1A.2** Implement `create_agent` instruction — init PDA, validate template (0-3), validate name length
- [x] **1A.3** Implement agent vault PDA (`[b"agent_vault", owner]`)
- [x] **1A.4** Implement `fund_agent` instruction — transfer SOL from owner to vault
- [x] **1A.5** Implement `withdraw` instruction — transfer SOL from vault to owner, validate signer
- [x] **1A.6** Implement `update_stats` instruction — callable by game authority only
- [x] **1A.7** Write tests: create agent, fund, withdraw, invalid template rejection
- [x] **1A.8** Build and deploy to devnet

#### 1B: Wager Escrow Program

- [x] **1B.1** Define `TableEscrow` struct (table_id, wager_tier, players array, status, winner)
- [x] **1B.2** Define `TableStatus` enum (Open, Full, InProgress, Settled)
- [x] **1B.3** Implement `initialize_treasury` — one-time setup for platform treasury PDA
- [x] **1B.4** Implement `create_table` — authority creates table with wager tier
- [x] **1B.5** Implement `join_table` — transfer wager from agent vault to table vault, register player
- [x] **1B.6** Implement auto-status update: `player_count == 6` → status = Full
- [x] **1B.7** Implement `start_game` — mark table as InProgress (called by game server)
- [x] **1B.8** Implement `settle_table` — pay 95% to winner vault, 5% to treasury
- [x] **1B.9** Implement `refund_table` — return wagers if game cancelled
- [x] **1B.10** Write tests: full table lifecycle (create → join x6 → start → settle)
- [x] **1B.11** Write tests: refund flow, edge cases (join when full, settle when not in progress)
- [x] **1B.12** Build and deploy to devnet

#### 1C: Spectator Betting Program

- [x] **1C.1** Define `BettingPool` struct (table_id, agents, total_pool, bet_count, status, winner)
- [x] **1C.2** Define `BetAccount` PDA struct (bettor, pool, agent_index, amount, claimed)
- [x] **1C.3** Define `PoolStatus` enum (Open, Locked, Settled)
- [x] **1C.4** Implement `create_pool` — created alongside table, list all 6 agents
- [x] **1C.5** Implement `place_bet` — transfer SOL from bettor to pool vault, create BetAccount PDA
- [x] **1C.6** Implement `lock_pool` — called when game starts, no more bets
- [x] **1C.7** Implement `settle_pool` — set winner, transfer 5% rake to treasury
- [x] **1C.8** Implement `claim_winnings` — pro-rata payout calculation (u128 math for overflow safety)
- [x] **1C.9** Write tests: place bets, lock, settle, claim, non-winner claim rejection
- [x] **1C.10** Build and deploy to devnet

---

### Phase 2: Poker Game Program (MagicBlock PER)

#### 2A: Core Game State

- [x] **2A.1** Define `GameState` account struct (table_id, phase, deck, community_cards, pot, players)
- [x] **2A.2** Define flat arrays for player state (players, player_status, player_bets) + separate `PlayerHand` PDA struct
- [x] **2A.3** Define enums: `GamePhase`, `PlayerStatus`, `ActionType`, `PokerAction`
- [x] **2A.4** Add `#[ephemeral]` macro to program module
- [x] **2A.5** Implement `initialize_game` — create GameState PDA, set up 6 players

#### 2B: Delegation & PER

- [x] **2B.1** Implement generic `delegate_pda` instruction using `#[delegate]` macro, `del` attribute, and `AccountType` enum for both GameState and PlayerHand
- [x] **2B.2** Configure delegation to MagicBlock TEE validator (optional validator field in DelegatePda)
- [x] **2B.3** Implement combined `showdown` using `#[commit]` macro + `game.exit()` + `commit_and_undelegate_accounts`
- [ ] **2B.4** Test delegation → PER execution → undelegation flow on devnet

#### 2C: VRF Card Dealing

- [x] **2C.1** Add `ephemeral_vrf_sdk` dependency
- [x] **2C.2** Implement `request_shuffle` with `#[vrf]` macro on context struct and `DEFAULT_EPHEMERAL_QUEUE` oracle address
- [x] **2C.3** Implement `callback_shuffle` — Fisher-Yates shuffle with VRF randomness; `vrf_program_identity` signer validates callback authenticity
- [x] **2C.4** Deal 2 cards per player, set community card indices
- [x] **2C.5** Set blinds (small blind = 2% of stack, big blind = 2x small blind)
- [x] **2C.6** Set first active player (left of big blind)
- [ ] **2C.7** Test VRF request → callback → verify deck shuffle

#### 2D: Poker Game Logic

- [x] **2D.1** Implement `player_action` instruction — validate turn, validate legal action
- [x] **2D.2** Implement Fold logic — set player status to Folded
- [x] **2D.3** Implement Check logic — validate no outstanding bet
- [x] **2D.4** Implement Call logic — match current bet, handle partial all-in
- [x] **2D.5** Implement Raise logic — validate sufficient chips, reset round actions
- [x] **2D.6** Implement AllIn logic — handle side pot tracking (simplified for MVP)
- [x] **2D.7** Implement `advance_turn` — skip folded/eliminated players
- [x] **2D.8** Implement `is_round_complete` — all active players matched current bet
- [x] **2D.9** Implement `advance_phase` — reveal community cards, reset round state
- [x] **2D.10** Implement auto-win detection — only 1 active player remaining
- [x] **2D.11** Test full hand: preflop → flop → turn → river → showdown

#### 2E: Hand Evaluation

- [x] **2E.1** Create `hand_eval.rs` module
- [x] **2E.2** Implement card parsing (value + suit from u8 index)
- [x] **2E.3** Implement hand category detection: high card, pair, two pair, trips, straight, flush, full house, quads, straight flush
- [x] **2E.4** Implement `evaluate_hand` — 7-card evaluator returning u32 rank
- [x] **2E.5** Implement tiebreaker logic (kickers)
- [x] **2E.6** Implement `evaluate_winner` — compare all active players, return best
- [x] **2E.7** Implement `showdown` instruction — evaluate hands, emit GameFinished event
- [x] **2E.8** Write exhaustive tests: all 9 hand categories, tiebreakers, edge cases (split pot)

#### 2F: PER Permissions (Privacy)

- [x] **2F.1** Implement `create_permission` instruction with `CreatePermissionCpiBuilder` on-chain CPI (NOT from TypeScript)
- [x] **2F.2** Set up Permission Program CPI for PlayerHand accounts (per-agent read access via members)
- [x] **2F.3** Implement `CreatePermission` account context with `PERMISSION_PROGRAM_ID` validation
- [x] **2F.4** Implement `UpdatePermissionCpiBuilder` in showdown to make all hands public (members: None)
- [ ] **2F.5** Test: verify agent can only read own hand via TEE endpoint
- [ ] **2F.6** Test: verify spectator cannot read any hands before showdown

---

### Phase 3: Game Server

#### 3A: LLM Gateway

- [x] **3A.1** Set up Anthropic SDK client with API key from env
- [x] **3A.2** Write 4 agent template files (shark.txt, maniac.txt, rock.txt, fox.txt)
- [x] **3A.3** Implement template loader with caching
- [x] **3A.4** Implement `getLLMAction` — build prompt from game state, call Claude Haiku
- [x] **3A.5** Implement card formatting helpers (index → "A♠" format)
- [x] **3A.6** Implement legal action calculator
- [x] **3A.7** Implement JSON response parser with fallback (invalid JSON → fold)
- [x] **3A.8** Test: verify each template produces valid actions for sample game states
- [x] **3A.9** Test: verify fallback behavior on malformed LLM responses

#### 3B: Turn Orchestrator

- [x] **3B.1** Implement `GameOrchestrator` class — connect to Solana, load programs
- [x] **3B.2** Implement dual-connection setup: `pokerProgram` (base layer) + `ephemeralPokerProgram` (TEE endpoint with auth token); all in-game txs routed through TEE ER
- [x] **3B.3** Implement VRF shuffle request (via ER) + callback poll (`waitForShuffle`)
- [x] **3B.4** Implement main game loop: read state → call LLM → submit action (via ER) → broadcast
- [x] **3B.5** Implement phase detection and showdown triggering
- [x] **3B.6** Implement game finish: showdown (commit + undelegate in one tx), settle escrow, settle betting on L1
- [x] **3B.7** Implement spectator state sanitization (no private data)
- [x] **3B.8** Add 2-3 second pacing delay between actions for spectator experience
- [x] **3B.9** Add error handling: LLM timeout, tx failure, PER disconnection
- [x] **3B.10** Test: run full simulated game with mock LLM responses
- [ ] **3B.11** Delegate all 7 PDAs (1 GameState + 6 PlayerHand) to TEE validator, not just GameState
- [ ] **3B.12** Create on-chain permissions for all 7 PDAs via `create_permission` instruction
- [ ] **3B.13** Delegate permission PDAs to TEE validator via `createDelegatePermissionInstruction`
- [ ] **3B.14** Wait for permissions to be active via `waitUntilPermissionActive` before proceeding
- [ ] **3B.15** Get auth token via `getAuthToken()` and create authenticated TEE connection

#### 3C: Matchmaker

- [x] **3C.1** Implement queue system with per-tier buckets ($1, $3, $5, $10)
- [x] **3C.2** Implement `addToQueue` — deduplicate, broadcast queue updates
- [x] **3C.3** Implement `startTable` — create table, join agents, create betting pool
- [x] **3C.4** Implement 60-second spectator betting window with countdown
- [x] **3C.5** Implement lock betting → start game → hand off to orchestrator
- [x] **3C.6** Add timeout handling: if queue doesn't fill in X minutes, partial table or refund
- [x] **3C.7** Test: queue 6 agents → table created → game runs

#### 3D: Spectator WebSocket Feed

- [x] **3D.1** Set up @fastify/websocket on the Fastify server
- [x] **3D.2** Implement room-based table subscription (join/leave)
- [x] **3D.3** Implement `broadcast(tableId, event)` for game events
- [x] **3D.4** Implement `broadcastGlobal(event)` for queue updates, new tables
- [x] **3D.5** Define event types: game_started, thinking, action, showdown, settled, queue_update, table_created
- [x] **3D.6** Test: connect client, subscribe to table, verify events received

#### 3E: REST API

- [x] **3E.1** `POST /api/queue` — add agent to matchmaking queue
- [x] **3E.2** `GET /api/tables` — list active/open tables
- [x] **3E.3** `GET /api/tables/:id` — get table details + game state
- [x] **3E.4** `GET /api/leaderboard` — top agents by wins/earnings
- [x] **3E.5** `GET /api/agent/:pubkey` — agent profile and stats
- [x] **3E.6** Add CORS configuration for frontend origin

---

### Phase 4: Frontend

#### 4A: Project Setup & Layout

- [x] **4A.1** Configure Solana wallet adapter provider (Phantom, Solflare, Backpack)
- [x] **4A.2** Create root layout with Navbar, WalletButton
- [x] **4A.3** Set up native WebSocket client hook for game server connection
- [x] **4A.4** Install and configure shadcn/ui components (button, card, input, dialog, tabs)
- [x] **4A.5** Set up dark theme (poker-room aesthetic)

#### 4B: Landing Page

- [x] **4B.1** Hero section: "AI Poker Arena" headline, tagline, CTA buttons
- [x] **4B.2** "How it Works" section: 3-step flow (Create Agent → Fund → Watch)
- [x] **4B.3** Live stats banner: active tables, total games, total wagered
- [x] **4B.4** Template preview cards showing the 4 agent types

#### 4C: Agent Management

- [x] **4C.1** Create agent page: template picker (4 cards with descriptions)
- [x] **4C.2** Agent naming input (max 20 chars, validation)
- [x] **4C.3** Transaction: call `create_agent` on-chain
- [x] **4C.4** Agent dashboard: show agent stats (games, wins, earnings)
- [x] **4C.5** Fund agent: SOL amount input + `fund_agent` transaction
- [x] **4C.6** Withdraw: amount input + `withdraw` transaction
- [x] **4C.7** "Queue for Game" button: select wager tier → call `/api/queue`
- [x] **4C.8** Queue status indicator: "Waiting for players... (3/6)"

#### 4D: Table Browser

- [x] **4D.1** Table list page: cards showing active/upcoming tables
- [x] **4D.2** Each card shows: wager tier, player count, phase, time remaining
- [x] **4D.3** Filter by wager tier
- [x] **4D.4** "Betting Open" badge for tables in betting window
- [x] **4D.5** Real-time updates via global WebSocket events

#### 4E: Spectator View (Core)

- [x] **4E.1** Poker table component: oval green felt with 6 seats
- [x] **4E.2** Player seat component: name, template icon, chip count, status indicator
- [x] **4E.3** Card component with flip animation (face-down → face-up)
- [x] **4E.4** Community cards display (center of table, revealed progressively)
- [x] **4E.5** Pot display (animated chip pile in center)
- [x] **4E.6** Active player highlight (glow/pulse animation)
- [x] **4E.7** "Thinking..." bubble with animated dots when LLM is processing
- [x] **4E.8** Action log panel: scrolling feed of "Shark raised $5" with reasoning quotes
- [x] **4E.9** Showdown animation: reveal all hole cards with hand name labels
- [x] **4E.10** Winner celebration animation (chips sliding to winner)
- [x] **4E.11** Connect to WebSocket for real-time game events
- [x] **4E.12** Handle all event types: game_started, thinking, action, showdown, settled

#### 4F: Spectator Betting

- [x] **4F.1** Betting panel: show 6 agents with odds
- [x] **4F.2** SOL amount input for bet size
- [x] **4F.3** "Place Bet" button → `place_bet` on-chain transaction
- [x] **4F.4** Countdown timer for betting window (60 seconds)
- [x] **4F.5** Bet confirmation display: "You bet $5 on Shark"
- [x] **4F.6** Potential payout calculator
- [x] **4F.7** Post-game: "You won $12!" or "Better luck next time" display
- [x] **4F.8** Claim winnings button → `claim_winnings` on-chain transaction

#### 4G: Leaderboard

- [x] **4G.1** Top agents table: rank, name, template, games, wins, win rate, earnings
- [x] **4G.2** Sortable columns
- [x] **4G.3** Agent profile link (click row → agent detail page)

---

### Phase 5: Integration & Testing

#### 5A: Local E2E Testing

- [ ] **5A.1** Script to spin up: local validator + MagicBlock ER validator + deploy programs
- [ ] **5A.2** Run a full game locally: create agents → queue → match → play → settle
- [ ] **5A.3** Verify escrow: correct amounts deposited and paid out
- [ ] **5A.4** Verify betting: bets placed, pool locked, winners paid, losers rejected
- [ ] **5A.5** Verify privacy: player hands not visible to non-authorized readers during game
- [ ] **5A.6** Verify VRF: deck is shuffled differently each game

#### 5B: Devnet Testing

- [ ] **5B.1** Deploy all 4 programs to Solana devnet
- [ ] **5B.2** Configure game server for devnet RPC + MagicBlock devnet TEE
- [ ] **5B.3** Run 10 full games end-to-end
- [ ] **5B.4** Test spectator betting flow with real wallet interactions
- [ ] **5B.5** Test concurrent games (2+ tables running simultaneously)
- [ ] **5B.6** Measure and optimize: LLM latency, tx confirmation time, spectator feed delay

#### 5C: Security Review

- [ ] **5C.1** Audit escrow logic: verify no funds can be drained by non-authority
- [ ] **5C.2** Audit betting logic: verify no double-claim, no claim without winning
- [ ] **5C.3** Verify game server authority checks on all settle/update instructions
- [ ] **5C.4** Verify PER permissions: no unauthorized hand reads
- [ ] **5C.5** Review LLM prompt injection risks (can a display name influence LLM behavior?)
- [ ] **5C.6** Verify VRF cannot be gamed (client_seed is blinded)
- [x] **5C.7** Rate limit spectator bets (prevent spam attacks on pool)

#### 5D: Deployment

- [ ] **5D.1** Deploy programs to Solana mainnet-beta
- [ ] **5D.2** Deploy game server to Railway with env vars
- [ ] **5D.3** Deploy frontend to Vercel
- [ ] **5D.4** Configure production MagicBlock TEE endpoint
- [ ] **5D.5** Set up monitoring: game server health, LLM costs tracking, error alerts
- [ ] **5D.6** Seed initial games with house agents for launch

---

### Summary

| Phase                | Tasks         | Estimated Scope                 |
| -------------------- | ------------- | ------------------------------- |
| Phase 0: Setup       | 8 tasks       | Foundation                      |
| Phase 1: L1 Programs | 27 tasks      | Agent + Escrow + Betting        |
| Phase 2: Poker PER   | 27 tasks      | Core game on MagicBlock (PER + VRF) |
| Phase 3: Game Server | 31 tasks      | LLM + Orchestrator + Matchmaker + TEE/PER setup |
| Phase 4: Frontend    | 31 tasks      | UI + Spectator + Betting        |
| Phase 5: Integration | 17 tasks      | Testing + Security + Deploy     |
| **Total**            | **141 tasks** |                                 |
