use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("Ed684BPr262EGicZGayjLNB8ujMYct771bc8LMBV5CUf");

pub const SESSION_SEED: &[u8] = b"session";
pub const SESSION_VAULT_SEED: &[u8] = b"session_vault";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const MAX_DEPOSITS: usize = 6;
pub const RAKE_BPS: u64 = 500; // 5%
pub const BPS_BASE: u64 = 10_000;

#[program]
pub mod agent_poker_escrow {
    use super::*;

    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        msg!("Treasury initialized: {}", ctx.accounts.treasury.key());
        Ok(())
    }

    pub fn create_session(
        ctx: Context<CreateSession>,
        session_id: u64,
        game_type: u8,
    ) -> Result<()> {
        let session = &mut ctx.accounts.session;
        session.session_id = session_id;
        session.game_type = game_type;
        session.depositors = [Pubkey::default(); MAX_DEPOSITS];
        session.deposits = [0u64; MAX_DEPOSITS];
        session.deposit_count = 0;
        session.total_deposited = 0;
        session.status = SessionStatus::Open;
        session.authority = ctx.accounts.authority.key();
        session.created_at = Clock::get()?.unix_timestamp;
        session.bump = ctx.bumps.session;
        session.vault_bump = ctx.bumps.session_vault;

        msg!(
            "Session {} created | game_type={}",
            session_id,
            game_type
        );
        Ok(())
    }

    pub fn deposit(ctx: Context<MakeDeposit>, amount: u64) -> Result<()> {
        require!(amount > 0, SettlementError::InvalidDepositAmount);

        let session = &mut ctx.accounts.session;
        require!(
            session.status == SessionStatus::Open,
            SettlementError::SessionNotOpen
        );

        let depositor_key = ctx.accounts.depositor.key();

        // Check for duplicate depositor before checking capacity
        for i in 0..session.deposit_count as usize {
            require!(
                session.depositors[i] != depositor_key,
                SettlementError::AlreadyDeposited
            );
        }

        require!(
            (session.deposit_count as usize) < MAX_DEPOSITS,
            SettlementError::SessionFull
        );

        // Transfer from depositor to vault
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.depositor.to_account_info(),
                    to: ctx.accounts.session_vault.to_account_info(),
                },
            ),
            amount,
        )?;

        let idx = session.deposit_count as usize;
        session.depositors[idx] = depositor_key;
        session.deposits[idx] = amount;
        session.deposit_count += 1;
        session.total_deposited = session
            .total_deposited
            .checked_add(amount)
            .ok_or(SettlementError::ArithmeticOverflow)?;

        msg!(
            "Deposit to session {} | depositor={} amount={} total={}",
            session.session_id,
            depositor_key,
            amount,
            session.total_deposited
        );

        Ok(())
    }

    pub fn lock_session(ctx: Context<LockSession>) -> Result<()> {
        let session = &mut ctx.accounts.session;
        require!(
            session.status == SessionStatus::Open,
            SettlementError::SessionNotOpen
        );
        require!(session.deposit_count > 0, SettlementError::NoDeposits);

        session.status = SessionStatus::Locked;
        msg!("Session {} locked", session.session_id);
        Ok(())
    }

    pub fn settle<'a>(
        ctx: Context<'_, '_, 'a, 'a, Settle<'a>>,
        payouts: Vec<Payout>,
    ) -> Result<()> {
        let session = &mut ctx.accounts.session;
        require!(
            session.status == SessionStatus::Locked,
            SettlementError::SessionNotLocked
        );

        let total_deposited = session.total_deposited;
        let rake = total_deposited
            .checked_mul(RAKE_BPS)
            .ok_or(SettlementError::ArithmeticOverflow)?
            .checked_div(BPS_BASE)
            .ok_or(SettlementError::ArithmeticOverflow)?;

        let distributable = total_deposited
            .checked_sub(rake)
            .ok_or(SettlementError::ArithmeticOverflow)?;

        // Validate payouts sum to distributable amount
        let payout_total: u64 = payouts
            .iter()
            .try_fold(0u64, |acc, p| acc.checked_add(p.amount))
            .ok_or(SettlementError::ArithmeticOverflow)?;
        require!(
            payout_total == distributable,
            SettlementError::PayoutMismatch
        );

        // Validate remaining_accounts match payout recipients
        require!(
            ctx.remaining_accounts.len() == payouts.len(),
            SettlementError::InvalidPayoutAccounts
        );

        let session_id_bytes = session.session_id.to_le_bytes();
        let vault_bump = session.vault_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            SESSION_VAULT_SEED,
            session_id_bytes.as_ref(),
            &[vault_bump],
        ]];

        let system_program_info = ctx.accounts.system_program.to_account_info();
        let vault_info = ctx.accounts.session_vault.to_account_info();

        for (i, payout) in payouts.iter().enumerate() {
            let recipient = &ctx.remaining_accounts[i];
            require!(
                recipient.key() == payout.recipient,
                SettlementError::InvalidPayoutAccounts
            );

            system_program::transfer(
                CpiContext::new_with_signer(
                    system_program_info.clone(),
                    system_program::Transfer {
                        from: vault_info.clone(),
                        to: recipient.clone(),
                    },
                    signer_seeds,
                ),
                payout.amount,
            )?;
        }

        // Transfer rake to treasury
        if rake > 0 {
            system_program::transfer(
                CpiContext::new_with_signer(
                    system_program_info.clone(),
                    system_program::Transfer {
                        from: vault_info.clone(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                    signer_seeds,
                ),
                rake,
            )?;
        }

        session.status = SessionStatus::Settled;
        msg!(
            "Session {} settled | distributed={} rake={}",
            session.session_id,
            payout_total,
            rake
        );
        Ok(())
    }

    pub fn refund_session<'a>(
        ctx: Context<'_, '_, 'a, 'a, RefundSession<'a>>,
    ) -> Result<()> {
        let session = &mut ctx.accounts.session;
        require!(
            session.status == SessionStatus::Open
                || session.status == SessionStatus::Locked,
            SettlementError::CannotRefund
        );

        let deposit_count = session.deposit_count as usize;

        // remaining_accounts: [recipient_0, ..., recipient_N-1]
        require!(
            ctx.remaining_accounts.len() == deposit_count,
            SettlementError::InvalidRefundAccounts
        );

        let session_id_bytes = session.session_id.to_le_bytes();
        let vault_bump = session.vault_bump;
        let signer_seeds: &[&[&[u8]]] = &[&[
            SESSION_VAULT_SEED,
            session_id_bytes.as_ref(),
            &[vault_bump],
        ]];

        let system_program_info = ctx.accounts.system_program.to_account_info();
        let vault_info = ctx.accounts.session_vault.to_account_info();

        for i in 0..deposit_count {
            let recipient = &ctx.remaining_accounts[i];
            require!(
                recipient.key() == session.depositors[i],
                SettlementError::InvalidRefundAccounts
            );

            system_program::transfer(
                CpiContext::new_with_signer(
                    system_program_info.clone(),
                    system_program::Transfer {
                        from: vault_info.clone(),
                        to: recipient.clone(),
                    },
                    signer_seeds,
                ),
                session.deposits[i],
            )?;

            msg!(
                "Refunded {} lamports to {}",
                session.deposits[i],
                session.depositors[i]
            );
        }

        session.status = SessionStatus::Cancelled;
        session.deposit_count = 0;
        session.depositors = [Pubkey::default(); MAX_DEPOSITS];
        session.deposits = [0u64; MAX_DEPOSITS];
        session.total_deposited = 0;

        msg!(
            "Session {} refunded and cancelled",
            session.session_id
        );
        Ok(())
    }
}

// =============================================================================
// Account context structs
// =============================================================================

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8,
        seeds = [TREASURY_SEED],
        bump,
    )]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(session_id: u64)]
pub struct CreateSession<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Session::MAX_SIZE,
        seeds = [SESSION_SEED, session_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub session: Account<'info, Session>,

    /// CHECK: Session vault is a PDA used solely as a lamport holder.
    /// Validated by seeds constraint.
    #[account(
        mut,
        seeds = [SESSION_VAULT_SEED, session_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub session_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MakeDeposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [SESSION_SEED, session.session_id.to_le_bytes().as_ref()],
        bump = session.bump,
    )]
    pub session: Account<'info, Session>,

    /// CHECK: Session vault PDA. Validated by seeds constraint.
    #[account(
        mut,
        seeds = [SESSION_VAULT_SEED, session.session_id.to_le_bytes().as_ref()],
        bump = session.vault_bump,
    )]
    pub session_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LockSession<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SESSION_SEED, session.session_id.to_le_bytes().as_ref()],
        bump = session.bump,
        has_one = authority @ SettlementError::Unauthorized,
    )]
    pub session: Account<'info, Session>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SESSION_SEED, session.session_id.to_le_bytes().as_ref()],
        bump = session.bump,
        has_one = authority @ SettlementError::Unauthorized,
    )]
    pub session: Account<'info, Session>,

    /// CHECK: Session vault PDA
    #[account(
        mut,
        seeds = [SESSION_VAULT_SEED, session.session_id.to_le_bytes().as_ref()],
        bump = session.vault_bump,
    )]
    pub session_vault: SystemAccount<'info>,

    /// CHECK: Treasury PDA. Validated by seeds constraint.
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump,
    )]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: [recipient_0, ..., recipient_N-1]
}

#[derive(Accounts)]
pub struct RefundSession<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SESSION_SEED, session.session_id.to_le_bytes().as_ref()],
        bump = session.bump,
        has_one = authority @ SettlementError::Unauthorized,
    )]
    pub session: Account<'info, Session>,

    /// CHECK: Session vault PDA
    #[account(
        mut,
        seeds = [SESSION_VAULT_SEED, session.session_id.to_le_bytes().as_ref()],
        bump = session.vault_bump,
    )]
    pub session_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: [recipient_0, ..., recipient_N-1]
}

// =============================================================================
// Data structures
// =============================================================================

#[account]
pub struct Session {
    pub session_id: u64,
    pub game_type: u8,
    pub depositors: [Pubkey; MAX_DEPOSITS],
    pub deposits: [u64; MAX_DEPOSITS],
    pub deposit_count: u8,
    pub total_deposited: u64,
    pub status: SessionStatus,
    pub authority: Pubkey,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Session {
    pub const MAX_SIZE: usize =
        8 + 1 + (32 * MAX_DEPOSITS) + (8 * MAX_DEPOSITS) + 1 + 8 + 1 + 32 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    Open,
    Locked,
    Settled,
    Cancelled,
}

#[account]
pub struct Treasury {}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Payout {
    pub recipient: Pubkey,
    pub amount: u64,
}

// =============================================================================
// Errors
// =============================================================================

#[error_code]
pub enum SettlementError {
    #[msg("Only the session authority can perform this action.")]
    Unauthorized,
    #[msg("Deposit amount must be greater than zero.")]
    InvalidDepositAmount,
    #[msg("Session is not open for deposits.")]
    SessionNotOpen,
    #[msg("Session is full (max deposits reached).")]
    SessionFull,
    #[msg("Depositor has already deposited to this session.")]
    AlreadyDeposited,
    #[msg("Session is not locked for settlement.")]
    SessionNotLocked,
    #[msg("No deposits have been made.")]
    NoDeposits,
    #[msg("Payout total does not match distributable amount (total - rake).")]
    PayoutMismatch,
    #[msg("Invalid payout accounts provided.")]
    InvalidPayoutAccounts,
    #[msg("Cannot refund a session that is already settled or cancelled.")]
    CannotRefund,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow,
    #[msg("Invalid refund accounts provided.")]
    InvalidRefundAccounts,
}
