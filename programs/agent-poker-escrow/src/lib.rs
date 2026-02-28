use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("Ed684BPr262EGicZGayjLNB8ujMYct771bc8LMBV5CUf");

pub const TABLE_SEED: &[u8] = b"table";
pub const TABLE_VAULT_SEED: &[u8] = b"table_vault";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const AGENT_VAULT_SEED: &[u8] = b"agent_vault";
pub const MAX_PLAYERS: usize = 6;
pub const RAKE_BPS: u64 = 500; // 5%
pub const BPS_BASE: u64 = 10_000;

#[program]
pub mod agent_poker_escrow {
    use super::*;

    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        msg!("Treasury initialized: {}", ctx.accounts.treasury.key());
        Ok(())
    }

    pub fn create_table(ctx: Context<CreateTable>, table_id: u64, wager_tier: u64) -> Result<()> {
        require!(wager_tier > 0, EscrowError::InvalidWagerTier);

        let table = &mut ctx.accounts.table;
        table.table_id = table_id;
        table.wager_tier = wager_tier;
        table.players = [Pubkey::default(); MAX_PLAYERS];
        table.player_count = 0;
        table.status = TableStatus::Open;
        table.winner = None;
        table.authority = ctx.accounts.authority.key();
        table.created_at = Clock::get()?.unix_timestamp;
        table.bump = ctx.bumps.table;
        table.vault_bump = ctx.bumps.table_vault;

        msg!("Table {} created | wager_tier={}", table_id, wager_tier);

        Ok(())
    }

    pub fn join_table(ctx: Context<JoinTable>, _agent_vault_bump: u8) -> Result<()> {
        let table = &mut ctx.accounts.table;

        require!(table.status == TableStatus::Open, EscrowError::TableNotOpen);
        require!(
            (table.player_count as usize) < MAX_PLAYERS,
            EscrowError::TableFull
        );

        let agent_owner_key = ctx.accounts.agent_owner.key();

        for i in 0..table.player_count as usize {
            require!(
                table.players[i] != agent_owner_key,
                EscrowError::AlreadyJoined
            );
        }

        require!(
            ctx.accounts.agent_vault.lamports() >= table.wager_tier,
            EscrowError::InsufficientAgentFunds
        );

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.agent_owner.to_account_info(),
                    to: ctx.accounts.table_vault.to_account_info(),
                },
            ),
            table.wager_tier,
        )?;

        let idx = table.player_count as usize;
        table.players[idx] = agent_owner_key;
        table.player_count += 1;

        msg!(
            "Player {} joined table {} | {}/{}",
            agent_owner_key,
            table.table_id,
            table.player_count,
            MAX_PLAYERS
        );

        if table.player_count as usize == MAX_PLAYERS {
            table.status = TableStatus::Full;
            msg!("Table {} is now Full", table.table_id);
        }

        Ok(())
    }

    pub fn start_game(ctx: Context<StartGame>) -> Result<()> {
        let table = &mut ctx.accounts.table;

        require!(table.status == TableStatus::Full, EscrowError::TableNotFull);

        table.status = TableStatus::InProgress;

        msg!("Game started on table {}", table.table_id);

        Ok(())
    }

    pub fn settle_table(ctx: Context<SettleTable>, winner_index: u8) -> Result<()> {
        let table = &mut ctx.accounts.table;

        require!(
            table.status == TableStatus::InProgress,
            EscrowError::GameNotInProgress
        );
        require!(
            (winner_index as usize) < table.player_count as usize,
            EscrowError::InvalidWinnerIndex
        );

        let winner_pubkey = table.players[winner_index as usize];
        let table_id = table.table_id;
        let vault_bump = table.vault_bump;

        let total_pot = table
            .wager_tier
            .checked_mul(table.player_count as u64)
            .ok_or(EscrowError::ArithmeticOverflow)?;

        let rake_amount = total_pot
            .checked_mul(RAKE_BPS)
            .ok_or(EscrowError::ArithmeticOverflow)?
            .checked_div(BPS_BASE)
            .ok_or(EscrowError::ArithmeticOverflow)?;

        let winner_amount = total_pot
            .checked_sub(rake_amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;

        require!(
            ctx.accounts.table_vault.lamports() >= total_pot,
            EscrowError::InsufficientVaultFunds
        );

        let table_id_bytes = table_id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] =
            &[&[TABLE_VAULT_SEED, table_id_bytes.as_ref(), &[vault_bump]]];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.table_vault.to_account_info(),
                    to: ctx.accounts.winner_vault.to_account_info(),
                },
                signer_seeds,
            ),
            winner_amount,
        )?;

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.table_vault.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
                signer_seeds,
            ),
            rake_amount,
        )?;

        table.winner = Some(winner_pubkey);
        table.status = TableStatus::Settled;

        msg!(
            "Table {} settled | winner={} payout={} rake={}",
            table.table_id,
            winner_pubkey,
            winner_amount,
            rake_amount
        );

        Ok(())
    }

    pub fn refund_table<'a>(ctx: Context<'_, '_, 'a, 'a, RefundTable<'a>>) -> Result<()> {
        let table = &mut ctx.accounts.table;

        require!(
            table.status == TableStatus::Open || table.status == TableStatus::Full,
            EscrowError::CannotRefund
        );

        let wager = table.wager_tier;
        let player_count = table.player_count as usize;
        let table_id = table.table_id;
        let vault_bump = table.vault_bump;

        require!(
            ctx.remaining_accounts.len() == player_count,
            EscrowError::InvalidRefundAccounts
        );

        for i in 0..player_count {
            let player_vault_info = &ctx.remaining_accounts[i];
            let (expected_vault, _bump) = Pubkey::find_program_address(
                &[AGENT_VAULT_SEED, table.players[i].as_ref()],
                &agent_poker_agent::ID,
            );
            require!(
                player_vault_info.key() == expected_vault,
                EscrowError::InvalidRefundAccounts
            );
        }

        let table_id_bytes = table_id.to_le_bytes();
        let signer_seeds: &[&[&[u8]]] =
            &[&[TABLE_VAULT_SEED, table_id_bytes.as_ref(), &[vault_bump]]];

        let system_program_info = ctx.accounts.system_program.to_account_info();
        let table_vault_info = ctx.accounts.table_vault.to_account_info();

        for i in 0..player_count {
            let player_vault_info = ctx.remaining_accounts[i].clone();

            system_program::transfer(
                CpiContext::new_with_signer(
                    system_program_info.clone(),
                    system_program::Transfer {
                        from: table_vault_info.clone(),
                        to: player_vault_info,
                    },
                    signer_seeds,
                ),
                wager,
            )?;

            msg!("Refunded {} lamports to player {}", wager, table.players[i]);
        }

        table.status = TableStatus::Settled;
        table.player_count = 0;
        table.players = [Pubkey::default(); MAX_PLAYERS];

        msg!("Table {} refunded and closed", table.table_id);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Treasury is a PDA used solely as a lamport holder for rake fees.
    /// Validated by seeds constraint.
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
#[instruction(table_id: u64)]
pub struct CreateTable<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + TableEscrow::MAX_SIZE,
        seeds = [TABLE_SEED, table_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub table: Account<'info, TableEscrow>,

    /// CHECK: Table vault is a PDA used solely as a lamport holder for wagers.
    /// Validated by seeds constraint.
    #[account(
        mut,
        seeds = [TABLE_VAULT_SEED, table_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub table_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinTable<'info> {
    #[account(mut)]
    pub agent_owner: Signer<'info>,

    #[account(
        mut,
        seeds = [TABLE_SEED, table.table_id.to_le_bytes().as_ref()],
        bump = table.bump,
    )]
    pub table: Account<'info, TableEscrow>,

    /// CHECK: Table vault PDA. Validated by seeds constraint.
    #[account(
        mut,
        seeds = [TABLE_VAULT_SEED, table.table_id.to_le_bytes().as_ref()],
        bump = table.vault_bump,
    )]
    pub table_vault: SystemAccount<'info>,

    /// CHECK: Agent vault is a PDA from the agent program: seeds = [b"agent_vault", agent_owner].
    /// Address is validated by the seeds constraint with seeds::program.
    #[account(
        mut,
        seeds = [AGENT_VAULT_SEED, agent_owner.key().as_ref()],
        bump,
        seeds::program = agent_poker_agent::ID,
    )]
    pub agent_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartGame<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [TABLE_SEED, table.table_id.to_le_bytes().as_ref()],
        bump = table.bump,
        has_one = authority @ EscrowError::Unauthorized,
    )]
    pub table: Account<'info, TableEscrow>,
}

#[derive(Accounts)]
#[instruction(winner_index: u8)]
pub struct SettleTable<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [TABLE_SEED, table.table_id.to_le_bytes().as_ref()],
        bump = table.bump,
        has_one = authority @ EscrowError::Unauthorized,
    )]
    pub table: Account<'info, TableEscrow>,

    /// CHECK: Table vault PDA
    #[account(
        mut,
        seeds = [TABLE_VAULT_SEED, table.table_id.to_le_bytes().as_ref()],
        bump = table.vault_bump,
    )]
    pub table_vault: SystemAccount<'info>,

    /// CHECK: Winner's agent vault PDA
    #[account(
        mut,
        address = Pubkey::find_program_address(
            &[AGENT_VAULT_SEED, table.players[winner_index as usize].as_ref()],
            &agent_poker_agent::ID,
        ).0 @ EscrowError::InvalidWinnerVault,
    )]
    pub winner_vault: SystemAccount<'info>,

    /// CHECK: Treasury PDA. Validated by seeds constraint.
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump,
    )]
    pub treasury: Account<'info, Treasury>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundTable<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [TABLE_SEED, table.table_id.to_le_bytes().as_ref()],
        bump = table.bump,
        has_one = authority @ EscrowError::Unauthorized,
    )]
    pub table: Account<'info, TableEscrow>,

    /// CHECK: Table vault PDA
    #[account(
        mut,
        seeds = [TABLE_VAULT_SEED, table.table_id.to_le_bytes().as_ref()],
        bump = table.vault_bump,
    )]
    pub table_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct TableEscrow {
    pub table_id: u64,
    pub wager_tier: u64,
    pub players: [Pubkey; MAX_PLAYERS],
    pub player_count: u8,
    pub status: TableStatus,
    pub winner: Option<Pubkey>,
    pub authority: Pubkey,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl TableEscrow {
    pub const MAX_SIZE: usize = 8 + 8 + (32 * MAX_PLAYERS) + 1 + 1 + (1 + 32) + 32 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TableStatus {
    Open,
    Full,
    InProgress,
    Settled,
}

#[account]
pub struct Treasury {}

pub mod agent_poker_agent {
    use super::*;
    declare_id!("6xJviS1Mz3rArD3JciQ55u7K1xDqtYr1AGvSeWvW1dti");
}

#[error_code]
pub enum EscrowError {
    #[msg("Only the table authority can perform this action.")]
    Unauthorized,
    #[msg("Wager tier must be greater than zero.")]
    InvalidWagerTier,
    #[msg("Table is not open for new players.")]
    TableNotOpen,
    #[msg("Table is already full.")]
    TableFull,
    #[msg("Player has already joined this table.")]
    AlreadyJoined,
    #[msg("Table must be full to start the game.")]
    TableNotFull,
    #[msg("Game is not in progress.")]
    GameNotInProgress,
    #[msg("Invalid winner index.")]
    InvalidWinnerIndex,
    #[msg("Cannot refund a table that is in progress or already settled.")]
    CannotRefund,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow,
    #[msg("Insufficient funds in table vault.")]
    InsufficientVaultFunds,
    #[msg("Insufficient funds in agent vault.")]
    InsufficientAgentFunds,
    #[msg("Invalid agent vault PDA.")]
    InvalidAgentVault,
    #[msg("Invalid winner vault PDA.")]
    InvalidWinnerVault,
    #[msg("Invalid refund accounts provided.")]
    InvalidRefundAccounts,
}
