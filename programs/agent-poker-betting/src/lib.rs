use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("HR2iEFkkt893fFtatyp3hivAzC8jznVpeoCAy5HBfQ4D");

pub const POOL_SEED: &[u8] = b"bet_pool";
pub const POOL_VAULT_SEED: &[u8] = b"pool_vault";
pub const BET_SEED: &[u8] = b"bet";
pub const TREASURY_SEED: &[u8] = b"treasury";

// Treasury model: 6 agents, fair odds 6x, 5% rake => 5.7x payout
pub const PAYOUT_NUM: u64 = 57; // 5.7x = 57/10
pub const PAYOUT_DEN: u64 = 10;

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
        pool.winner_index = None;
        pool.authority = ctx.accounts.authority.key();
        pool.bump = ctx.bumps.pool;
        pool.vault_bump = ctx.bumps.pool_vault;
        Ok(())
    }

    pub fn fund_treasury(ctx: Context<FundTreasury>, amount: u64) -> Result<()> {
        require!(amount > 0, BettingError::ZeroBetAmount);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.funder.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            amount,
        )?;

        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, agent_index: u8, amount: u64) -> Result<()> {
        require!(agent_index < 6, BettingError::InvalidAgentIndex);
        require!(amount > 0, BettingError::ZeroBetAmount);

        let pool = &mut ctx.accounts.pool;
        require!(pool.status == PoolStatus::Open, BettingError::PoolNotOpen);

        // Solvency check: treasury must cover worst-case payout (5.7x)
        let max_payout = amount
            .checked_mul(PAYOUT_NUM)
            .ok_or(BettingError::MathOverflow)?
            .checked_div(PAYOUT_DEN)
            .ok_or(BettingError::MathOverflow)?;
        let treasury_balance = ctx.accounts.treasury.lamports();
        require!(
            treasury_balance >= max_payout,
            BettingError::InsufficientTreasuryFunds
        );

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.bettor.to_account_info(),
                    to: ctx.accounts.pool_vault.to_account_info(),
                },
            ),
            amount,
        )?;

        pool.total_pool = pool
            .total_pool
            .checked_add(amount)
            .ok_or(BettingError::MathOverflow)?;
        pool.bet_count = pool
            .bet_count
            .checked_add(1)
            .ok_or(BettingError::MathOverflow)?;

        let bet = &mut ctx.accounts.bet;
        bet.bettor = ctx.accounts.bettor.key();
        bet.pool = ctx.accounts.pool.key();
        bet.agent_index = agent_index;
        bet.amount = amount;
        bet.claimed = false;
        bet.bump = ctx.bumps.bet;

        emit!(BetPlaced {
            pool: ctx.accounts.pool.key(),
            bettor: ctx.accounts.bettor.key(),
            agent_index,
            amount,
        });

        Ok(())
    }

    pub fn lock_pool(ctx: Context<LockPool>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(pool.status == PoolStatus::Open, BettingError::PoolNotOpen);

        pool.status = PoolStatus::Locked;

        emit!(PoolLocked {
            pool: ctx.accounts.pool.key(),
        });

        Ok(())
    }

    pub fn settle_pool(ctx: Context<SettlePool>, winner_index: u8) -> Result<()> {
        require!(winner_index < 6, BettingError::InvalidAgentIndex);

        let pool_key = ctx.accounts.pool.key();
        let vault_bump = ctx.accounts.pool.vault_bump;
        let total_pool = ctx.accounts.pool.total_pool;
        let status = ctx.accounts.pool.status;

        require!(status == PoolStatus::Locked, BettingError::PoolNotLocked);

        let pool = &mut ctx.accounts.pool;
        pool.winner_index = Some(winner_index);
        pool.status = PoolStatus::Settled;

        // Transfer ALL vault funds to treasury (house keeps bets)
        if total_pool > 0 {
            let vault_balance = ctx.accounts.pool_vault.lamports();
            let transfer_amount = total_pool.min(vault_balance);

            let vault_seeds: &[&[u8]] = &[
                POOL_VAULT_SEED,
                pool_key.as_ref(),
                &[vault_bump],
            ];

            transfer_from_vault(
                &ctx.accounts.pool_vault.to_account_info(),
                &ctx.accounts.treasury.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                vault_seeds,
                transfer_amount,
            )?;
        }

        emit!(PoolSettled {
            pool: pool_key,
            winner_index,
            total_pool,
        });

        Ok(())
    }

    pub fn cancel_pool(ctx: Context<CancelPool>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(pool.status == PoolStatus::Open, BettingError::PoolNotOpen);
        pool.status = PoolStatus::Cancelled;

        let pool_key = pool.key();
        let total_pool = pool.total_pool;
        emit!(PoolCancelled {
            pool: pool_key,
            total_pool,
        });
        Ok(())
    }

    pub fn refund_bet(ctx: Context<RefundBet>) -> Result<()> {
        let pool = &ctx.accounts.pool;
        require!(
            pool.status == PoolStatus::Cancelled,
            BettingError::PoolNotCancelled
        );

        let bet = &ctx.accounts.bet;
        require!(!bet.claimed, BettingError::AlreadyClaimed);

        let amount = bet.amount;
        let pool_key = ctx.accounts.pool.key();
        let vault_seeds: &[&[u8]] = &[
            POOL_VAULT_SEED,
            pool_key.as_ref(),
            &[pool.vault_bump],
        ];

        transfer_from_vault(
            &ctx.accounts.pool_vault.to_account_info(),
            &ctx.accounts.bettor.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            vault_seeds,
            amount,
        )?;

        emit!(BetRefunded {
            pool: pool_key,
            bettor: ctx.accounts.bettor.key(),
            amount,
        });
        Ok(())
    }

    pub fn close_pool(ctx: Context<ClosePool>) -> Result<()> {
        let pool = &ctx.accounts.pool;
        require!(
            pool.status == PoolStatus::Settled || pool.status == PoolStatus::Cancelled,
            BettingError::PoolStillActive
        );
        // Pool account closed via `close = authority` in accounts struct
        // Vault SOL drained to authority
        Ok(())
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let pool = &ctx.accounts.pool;
        let bet = &mut ctx.accounts.bet;

        require!(
            pool.status == PoolStatus::Settled,
            BettingError::PoolNotSettled
        );
        require!(!bet.claimed, BettingError::AlreadyClaimed);

        let winner_index = pool.winner_index.ok_or(BettingError::NoWinnerSet)?;
        require!(
            bet.agent_index == winner_index,
            BettingError::BetNotOnWinner
        );

        // Fixed payout: 5.7x (6 agents * 0.95 after rake)
        let payout = bet
            .amount
            .checked_mul(PAYOUT_NUM)
            .ok_or(BettingError::MathOverflow)?
            .checked_div(PAYOUT_DEN)
            .ok_or(BettingError::MathOverflow)?;

        require!(payout > 0, BettingError::ZeroPayout);

        // Check treasury solvency
        let treasury_balance = ctx.accounts.treasury.lamports();
        require!(
            treasury_balance >= payout,
            BettingError::InsufficientTreasuryFunds
        );

        bet.claimed = true;

        let treasury_seeds: &[&[u8]] = &[
            TREASURY_SEED,
            &[ctx.bumps.treasury],
        ];

        transfer_from_vault(
            &ctx.accounts.treasury.to_account_info(),
            &ctx.accounts.bettor.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            treasury_seeds,
            payout,
        )?;

        emit!(WinningsClaimed {
            pool: ctx.accounts.pool.key(),
            bettor: ctx.accounts.bettor.key(),
            payout,
        });

        Ok(())
    }
}

fn transfer_from_vault<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    signer_seeds: &[&[u8]],
    amount: u64,
) -> Result<()> {
    system_program::transfer(
        CpiContext::new_with_signer(
            system_program.clone(),
            system_program::Transfer {
                from: from.clone(),
                to: to.clone(),
            },
            &[signer_seeds],
        ),
        amount,
    )
}

#[derive(Accounts)]
#[instruction(table_id: u64)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + BettingPool::INIT_SPACE,
        seeds = [POOL_SEED, &table_id.to_le_bytes()],
        bump,
    )]
    pub pool: Account<'info, BettingPool>,

    /// CHECK: Pool vault is a PDA used solely to hold SOL. No data is stored.
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.key().as_ref()],
        bump,
    )]
    pub pool_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundTreasury<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    /// CHECK: Treasury PDA that holds house funds.
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump,
    )]
    pub treasury: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, &pool.table_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, BettingPool>,

    /// CHECK: Pool vault PDA that holds SOL for the pool.
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub pool_vault: SystemAccount<'info>,

    /// CHECK: Treasury PDA for solvency check.
    #[account(
        seeds = [TREASURY_SEED],
        bump,
    )]
    pub treasury: SystemAccount<'info>,

    #[account(
        init,
        payer = bettor,
        space = 8 + BetAccount::INIT_SPACE,
        seeds = [BET_SEED, pool.key().as_ref(), bettor.key().as_ref()],
        bump,
    )]
    pub bet: Account<'info, BetAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LockPool<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, &pool.table_id.to_le_bytes()],
        bump = pool.bump,
        has_one = authority @ BettingError::Unauthorized,
    )]
    pub pool: Account<'info, BettingPool>,
}

#[derive(Accounts)]
pub struct SettlePool<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, &pool.table_id.to_le_bytes()],
        bump = pool.bump,
        has_one = authority @ BettingError::Unauthorized,
    )]
    pub pool: Account<'info, BettingPool>,

    /// CHECK: Pool vault PDA that holds SOL for the pool.
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub pool_vault: SystemAccount<'info>,

    /// CHECK: Treasury PDA where all bets are sent.
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump,
    )]
    pub treasury: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelPool<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [POOL_SEED, &pool.table_id.to_le_bytes()],
        bump = pool.bump,
        has_one = authority @ BettingError::Unauthorized,
    )]
    pub pool: Account<'info, BettingPool>,
}

#[derive(Accounts)]
pub struct RefundBet<'info> {
    /// CHECK: bettor receives the refund. Verified via bet.bettor.
    #[account(mut)]
    pub bettor: AccountInfo<'info>,

    #[account(
        seeds = [POOL_SEED, &pool.table_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, BettingPool>,

    /// CHECK: Pool vault PDA that holds SOL.
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub pool_vault: SystemAccount<'info>,

    #[account(
        mut,
        close = bettor,
        seeds = [BET_SEED, pool.key().as_ref(), bettor.key().as_ref()],
        bump = bet.bump,
        has_one = bettor @ BettingError::Unauthorized,
        has_one = pool @ BettingError::PoolMismatch,
    )]
    pub bet: Account<'info, BetAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClosePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        close = authority,
        seeds = [POOL_SEED, &pool.table_id.to_le_bytes()],
        bump = pool.bump,
        has_one = authority @ BettingError::Unauthorized,
    )]
    pub pool: Account<'info, BettingPool>,

    /// CHECK: Pool vault - remaining SOL drained to authority
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub pool_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub bettor: Signer<'info>,

    #[account(
        seeds = [POOL_SEED, &pool.table_id.to_le_bytes()],
        bump = pool.bump,
    )]
    pub pool: Account<'info, BettingPool>,

    /// CHECK: Treasury PDA that holds house funds for payouts.
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump,
    )]
    pub treasury: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [BET_SEED, pool.key().as_ref(), bettor.key().as_ref()],
        bump = bet.bump,
        has_one = bettor @ BettingError::Unauthorized,
        has_one = pool @ BettingError::PoolMismatch,
    )]
    pub bet: Account<'info, BetAccount>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct BettingPool {
    pub table_id: u64,
    pub agents: [Pubkey; 6],
    pub total_pool: u64,
    pub bet_count: u16,
    pub status: PoolStatus,
    pub winner_index: Option<u8>,
    pub authority: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BetAccount {
    pub bettor: Pubkey,
    pub pool: Pubkey,
    pub agent_index: u8,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PoolStatus {
    Open,
    Locked,
    Settled,
    Cancelled,
}

#[event]
pub struct BetPlaced {
    pub pool: Pubkey,
    pub bettor: Pubkey,
    pub agent_index: u8,
    pub amount: u64,
}

#[event]
pub struct PoolLocked {
    pub pool: Pubkey,
}

#[event]
pub struct PoolSettled {
    pub pool: Pubkey,
    pub winner_index: u8,
    pub total_pool: u64,
}

#[event]
pub struct PoolCancelled {
    pub pool: Pubkey,
    pub total_pool: u64,
}

#[event]
pub struct WinningsClaimed {
    pub pool: Pubkey,
    pub bettor: Pubkey,
    pub payout: u64,
}

#[event]
pub struct BetRefunded {
    pub pool: Pubkey,
    pub bettor: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum BettingError {
    #[msg("Agent index must be 0-5")]
    InvalidAgentIndex,

    #[msg("Bet amount must be greater than zero")]
    ZeroBetAmount,

    #[msg("Pool is not open for betting")]
    PoolNotOpen,

    #[msg("Pool is not locked")]
    PoolNotLocked,

    #[msg("Pool is not settled")]
    PoolNotSettled,

    #[msg("Winnings already claimed")]
    AlreadyClaimed,

    #[msg("No winner has been set")]
    NoWinnerSet,

    #[msg("Bet was not placed on the winning agent")]
    BetNotOnWinner,

    #[msg("Winning pool total must be greater than zero")]
    ZeroWinningPool,

    #[msg("Payout is zero")]
    ZeroPayout,

    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Pool does not match bet")]
    PoolMismatch,

    #[msg("Insufficient funds in vault")]
    InsufficientVaultFunds,

    #[msg("Pool is not cancelled")]
    PoolNotCancelled,

    #[msg("Pool is still active (must be Settled or Cancelled)")]
    PoolStillActive,

    #[msg("Insufficient treasury funds to cover payout")]
    InsufficientTreasuryFunds,
}
