use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("6xJviS1Mz3rArD3JciQ55u7K1xDqtYr1AGvSeWvW1dti");

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

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, AgentError::ZeroAmount);
        require!(
            ctx.accounts.vault.lamports() >= amount,
            AgentError::InsufficientFunds
        );

        let owner_key = ctx.accounts.agent.owner;
        let seeds: &[&[u8]] = &[
            AGENT_VAULT_SEED,
            owner_key.as_ref(),
            &[ctx.accounts.agent.vault_bump],
        ];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.owner.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        Ok(())
    }

    pub fn update_stats(
        ctx: Context<UpdateStats>,
        games_delta: u64,
        wins_delta: u64,
        earnings_delta: i64,
    ) -> Result<()> {
        let agent = &mut ctx.accounts.agent;
        agent.total_games = agent.total_games.saturating_add(games_delta);
        agent.total_wins = agent.total_wins.saturating_add(wins_delta);
        agent.total_earnings = agent.total_earnings.saturating_add(earnings_delta);
        Ok(())
    }
}

#[account]
pub struct AgentAccount {
    pub owner: Pubkey,
    pub template: u8,
    pub display_name: String,
    pub vault: Pubkey,
    pub total_games: u64,
    pub total_wins: u64,
    pub total_earnings: i64,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl AgentAccount {
    pub const MAX_SIZE: usize = 32 + 1 + (4 + MAX_DISPLAY_NAME_LEN) + 32 + 8 + 8 + 8 + 8 + 1 + 1;
}

#[derive(Accounts)]
pub struct CreateAgent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + AgentAccount::MAX_SIZE,
        seeds = [AGENT_SEED, owner.key().as_ref()],
        bump
    )]
    pub agent: Account<'info, AgentAccount>,

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
    pub authority: Signer<'info>,

    #[account(mut)]
    pub agent: Account<'info, AgentAccount>,
}

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
