use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::{
    CreatePermissionCpiBuilder, DelegatePermissionCpiBuilder, UpdatePermissionCpiBuilder,
};
use ephemeral_rollups_sdk::access_control::structs::MembersArgs;
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
pub const SMALL_BLIND_RATIO: u64 = 50;
pub const BIG_BLIND_RATIO: u64 = 100;
pub const RATIO_BASE: u64 = 1000;

/// Byte offset of the `hand` field inside a serialized PlayerHand account.
/// Layout after 8-byte Anchor discriminator: game_id(8) + player(32) = 40 → hand starts at 48.
const HAND_OFFSET: usize = 48;
/// Byte offset of the `bump` field inside a serialized PlayerHand account.
const BUMP_OFFSET: usize = 50;

#[ephemeral]
#[program]
pub mod agent_poker_game {
    use super::*;

    // =========================================================================
    // PRODUCTION INSTRUCTIONS (with MagicBlock ER / delegation)
    // =========================================================================

    /// Create a new game. Initialises GameState on L1 and sets up its permission
    /// for later delegation. Does NOT create any PlayerHand accounts — those are
    /// created one-by-one in `join_game`.
    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: u64,
        table_id: u64,
        wager_tier: u64,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.game_id = game_id;
        game.table_id = table_id;
        game.player_count = 0;
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
            game.players[i] = Pubkey::default();
            game.player_status[i] = PlayerStatus::Empty as u8;
            game.player_bets[i] = 0;
        }

        // CPI: create permission for GameState PDA
        let game_id_bytes = game_id.to_le_bytes();
        let game_bump = [ctx.bumps.game];
        let pda_signer: &[&[u8]] = &[GAME_SEED, game_id_bytes.as_ref(), game_bump.as_ref()];

        let game_info = ctx.accounts.game.to_account_info();
        let perm_info = ctx.accounts.permission.to_account_info();
        let payer_info = ctx.accounts.authority.to_account_info();
        let sys_info = ctx.accounts.system_program.to_account_info();
        let perm_prog = ctx.accounts.permission_program.to_account_info();

        CreatePermissionCpiBuilder::new(&perm_prog)
            .permissioned_account(&game_info)
            .permission(&perm_info)
            .payer(&payer_info)
            .system_program(&sys_info)
            .args(MembersArgs { members: None })
            .invoke_signed(&[pda_signer])?;

        // CPI: delegate the permission account
        DelegatePermissionCpiBuilder::new(&perm_prog)
            .payer(&payer_info)
            .authority(&game_info, true)
            .permissioned_account(&game_info, false)
            .permission(&perm_info)
            .system_program(&sys_info)
            .owner_program(&perm_prog)
            .delegation_buffer(&ctx.accounts.perm_delegation_buffer)
            .delegation_record(&ctx.accounts.perm_delegation_record)
            .delegation_metadata(&ctx.accounts.perm_delegation_metadata)
            .delegation_program(&ctx.accounts.delegation_program)
            .validator(Some(&ctx.accounts.validator))
            .invoke_signed(&[pda_signer])?;

        Ok(())
    }

    /// A player joins the game. Creates the PlayerHand account, sets up its
    /// permission, and delegates the hand to the Ephemeral Rollup.
    pub fn join_game(
        ctx: Context<JoinGame>,
        game_id: u64,
        seat_index: u8,
        player: Pubkey,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.phase == GamePhase::Waiting, GameError::InvalidPhase);
        require!(
            (seat_index as usize) < MAX_PLAYERS,
            GameError::InvalidSeatIndex
        );
        require!(
            game.player_status[seat_index as usize] == PlayerStatus::Empty as u8,
            GameError::SeatTaken
        );

        game.players[seat_index as usize] = player;
        game.player_status[seat_index as usize] = PlayerStatus::Active as u8;
        game.player_count += 1;

        // Initialise the hand
        let hand = &mut ctx.accounts.player_hand;
        hand.game_id = game_id;
        hand.player = player;
        hand.hand = [255u8; 2];
        hand.bump = ctx.bumps.player_hand;

        // Build signer seeds for the hand PDA
        let game_id_bytes = game_id.to_le_bytes();
        let seat_byte = [seat_index];
        let hand_bump = [ctx.bumps.player_hand];
        let hand_signer: &[&[u8]] = &[
            HAND_SEED,
            game_id_bytes.as_ref(),
            seat_byte.as_ref(),
            hand_bump.as_ref(),
        ];

        let hand_info = ctx.accounts.player_hand.to_account_info();
        let perm_info = ctx.accounts.hand_permission.to_account_info();
        let payer_info = ctx.accounts.payer.to_account_info();
        let sys_info = ctx.accounts.system_program.to_account_info();
        let perm_prog = ctx.accounts.permission_program.to_account_info();

        // CPI: create permission for the hand PDA
        CreatePermissionCpiBuilder::new(&perm_prog)
            .permissioned_account(&hand_info)
            .permission(&perm_info)
            .payer(&payer_info)
            .system_program(&sys_info)
            .args(MembersArgs { members: None })
            .invoke_signed(&[hand_signer])?;

        // CPI: delegate the hand's permission
        DelegatePermissionCpiBuilder::new(&perm_prog)
            .payer(&payer_info)
            .authority(&hand_info, true)
            .permissioned_account(&hand_info, false)
            .permission(&perm_info)
            .system_program(&sys_info)
            .owner_program(&perm_prog)
            .delegation_buffer(&ctx.accounts.perm_delegation_buffer)
            .delegation_record(&ctx.accounts.perm_delegation_record)
            .delegation_metadata(&ctx.accounts.perm_delegation_metadata)
            .delegation_program(&ctx.accounts.delegation_program)
            .validator(Some(&ctx.accounts.validator))
            .invoke_signed(&[hand_signer])?;

        // Flush hand data before delegation
        ctx.accounts.player_hand.exit(&crate::ID)?;

        // Delegate the hand account itself to ER
        let pda_seeds: &[&[u8]] = &[HAND_SEED, game_id_bytes.as_ref(), seat_byte.as_ref()];
        ctx.accounts.delegate_player_hand(
            &ctx.accounts.payer,
            pda_seeds,
            DelegateConfig {
                validator: Some(ctx.accounts.validator.key()),
                ..Default::default()
            },
        )?;

        Ok(())
    }

    /// Delegate GameState to the Ephemeral Rollup. Called after all players have
    /// joined. Permission was already created/delegated in `create_game`.
    pub fn start_game(ctx: Context<StartGame>, game_id: u64) -> Result<()> {
        let game = &ctx.accounts.game;
        require!(game.phase == GamePhase::Waiting, GameError::InvalidPhase);
        require!(game.player_count >= 2, GameError::InvalidPlayerCount);

        ctx.accounts.game.exit(&crate::ID)?;

        let game_id_bytes = game_id.to_le_bytes();
        let pda_seeds: &[&[u8]] = &[GAME_SEED, game_id_bytes.as_ref()];
        ctx.accounts.delegate_game(
            &ctx.accounts.payer,
            pda_seeds,
            DelegateConfig {
                validator: Some(ctx.accounts.validator.key()),
                ..Default::default()
            },
        )?;

        Ok(())
    }

    /// Request a VRF shuffle. Hand PDAs are passed via remaining_accounts.
    pub fn request_shuffle(ctx: Context<RequestShuffle>, client_seed: u8) -> Result<()> {
        require!(
            ctx.accounts.game.phase == GamePhase::Waiting,
            GameError::InvalidPhase
        );

        let player_count = ctx.accounts.game.player_count as usize;
        require!(
            ctx.remaining_accounts.len() == player_count,
            GameError::InvalidHandCount
        );

        // Build callback account metas: game + N hands
        let mut callback_accounts = vec![SerializableAccountMeta {
            pubkey: ctx.accounts.game.key(),
            is_signer: false,
            is_writable: true,
        }];

        let game_id_bytes = ctx.accounts.game.game_id.to_le_bytes();
        for i in 0..player_count {
            let hand_info = &ctx.remaining_accounts[i];
            verify_hand_pda(hand_info.key, &game_id_bytes, i as u8)?;
            callback_accounts.push(SerializableAccountMeta {
                pubkey: hand_info.key(),
                is_signer: false,
                is_writable: true,
            });
        }

        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackShuffle::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(callback_accounts),
            ..Default::default()
        });

        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    /// VRF callback: shuffle deck, deal cards, post blinds.
    /// Hand accounts arrive via remaining_accounts (set during request_shuffle).
    pub fn callback_shuffle(ctx: Context<CallbackShuffle>, randomness: [u8; 32]) -> Result<()> {
        let game = &mut ctx.accounts.game;
        let player_count = game.player_count as usize;
        require!(
            ctx.remaining_accounts.len() == player_count,
            GameError::InvalidHandCount
        );

        // Fisher-Yates shuffle
        let mut deck = [0u8; 52];
        for i in 0..52u8 {
            deck[i as usize] = i;
        }
        for i in (1..52usize).rev() {
            let j =
                ephemeral_vrf_sdk::rnd::random_u8_with_range(&randomness, 0, i as u8) as usize;
            deck.swap(i, j);
        }
        game.deck = deck;

        // Deal 2 cards to each player via remaining_accounts
        let game_id_bytes = game.game_id.to_le_bytes();
        for i in 0..player_count {
            let hand_info = &ctx.remaining_accounts[i];
            verify_hand_pda(hand_info.key, &game_id_bytes, i as u8)?;
            let mut data = hand_info.try_borrow_mut_data()?;
            data[HAND_OFFSET] = deck[i * 2];
            data[HAND_OFFSET + 1] = deck[i * 2 + 1];
        }

        // Community cards
        let c = player_count * 2;
        game.community_cards = [deck[c], deck[c + 1], deck[c + 2], deck[c + 3], deck[c + 4]];

        // Blinds
        let small_blind = game
            .wager_tier
            .checked_mul(SMALL_BLIND_RATIO)
            .ok_or(GameError::MathOverflow)?
            .checked_div(RATIO_BASE)
            .ok_or(GameError::MathOverflow)?;
        let big_blind = game
            .wager_tier
            .checked_mul(BIG_BLIND_RATIO)
            .ok_or(GameError::MathOverflow)?
            .checked_div(RATIO_BASE)
            .ok_or(GameError::MathOverflow)?;

        let sb_idx = ((game.dealer_index + 1) % game.player_count) as usize;
        let bb_idx = ((game.dealer_index + 2) % game.player_count) as usize;
        game.player_bets[sb_idx] = small_blind;
        game.player_bets[bb_idx] = big_blind;
        game.pot = small_blind
            .checked_add(big_blind)
            .ok_or(GameError::MathOverflow)?;
        game.current_bet = big_blind;

        let first = ((game.dealer_index + 3) % game.player_count) as usize;
        game.current_player = first as u8;
        game.last_raiser = bb_idx as u8;
        game.community_count = 0;
        game.phase = GamePhase::Preflop;
        game.last_action_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    /// Submit a player action (fold / check / call / raise / all-in).
    pub fn player_action(
        ctx: Context<PlayerAction>,
        action: u8,
        raise_amount: u64,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            matches!(
                game.phase,
                GamePhase::Preflop | GamePhase::Flop | GamePhase::Turn | GamePhase::River
            ),
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
                require!(
                    game.player_bets[player_idx] == game.current_bet,
                    GameError::CannotCheck
                );
            }
            ActionType::Call => {
                let call_amount = game
                    .current_bet
                    .checked_sub(game.player_bets[player_idx])
                    .ok_or(GameError::MathOverflow)?;
                game.player_bets[player_idx] = game.current_bet;
                game.pot = game
                    .pot
                    .checked_add(call_amount)
                    .ok_or(GameError::MathOverflow)?;
            }
            ActionType::Raise => {
                require!(raise_amount > game.current_bet, GameError::RaiseTooSmall);
                let additional = raise_amount
                    .checked_sub(game.player_bets[player_idx])
                    .ok_or(GameError::MathOverflow)?;
                game.player_bets[player_idx] = raise_amount;
                game.current_bet = raise_amount;
                game.pot = game
                    .pot
                    .checked_add(additional)
                    .ok_or(GameError::MathOverflow)?;
                game.last_raiser = player_idx as u8;
            }
            ActionType::AllIn => {
                let all_in_amount = game.wager_tier;
                let additional = all_in_amount
                    .checked_sub(game.player_bets[player_idx])
                    .ok_or(GameError::MathOverflow)?;
                game.player_bets[player_idx] = all_in_amount;
                if all_in_amount > game.current_bet {
                    game.current_bet = all_in_amount;
                    game.last_raiser = player_idx as u8;
                }
                game.pot = game
                    .pot
                    .checked_add(additional)
                    .ok_or(GameError::MathOverflow)?;
                game.player_status[player_idx] = PlayerStatus::AllIn as u8;
            }
        }

        game.last_action_at = Clock::get()?.unix_timestamp;

        let non_folded = count_non_folded_players(game);
        if non_folded <= 1 {
            game.phase = GamePhase::Showdown;
            return Ok(());
        }

        let active_only = count_strictly_active_players(game);
        if active_only == 0 {
            game.phase = GamePhase::Showdown;
            return Ok(());
        }

        let next = find_next_active_player(game, player_idx);
        if next == game.last_raiser as usize {
            advance_phase(game)?;
        } else {
            game.current_player = next as u8;
        }

        Ok(())
    }

    /// Production showdown: update hand permissions, evaluate winner, commit back to L1.
    /// remaining_accounts layout: [hand_0 .. hand_N, perm_0 .. perm_N]
    pub fn showdown<'a>(ctx: Context<'_, '_, 'a, 'a, Showdown<'a>>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.phase == GamePhase::Showdown
                || count_active_players(game) <= 1
                || game.phase == GamePhase::River,
            GameError::InvalidPhase
        );

        let player_count = game.player_count as usize;
        require!(
            ctx.remaining_accounts.len() == player_count * 2,
            GameError::InvalidHandCount
        );

        let hand_accounts = &ctx.remaining_accounts[..player_count];
        let perm_accounts = &ctx.remaining_accounts[player_count..];
        let permission_program = &ctx.accounts.permission_program.to_account_info();
        let game_id_bytes = game.game_id.to_le_bytes();

        // Update permissions for each hand to reveal them
        for i in 0..player_count {
            if game.player_status[i] == PlayerStatus::Empty as u8 {
                continue;
            }
            let hand_info = &hand_accounts[i];
            let perm_info = &perm_accounts[i];
            verify_hand_pda(hand_info.key, &game_id_bytes, i as u8)?;

            let hand_data = hand_info.try_borrow_data()?;
            let hand_bump = hand_data[BUMP_OFFSET];
            drop(hand_data);

            let seat_byte = [i as u8];
            UpdatePermissionCpiBuilder::new(permission_program)
                .permissioned_account(hand_info, true)
                .authority(hand_info, false)
                .permission(perm_info)
                .args(MembersArgs { members: None })
                .invoke_signed(&[&[
                    HAND_SEED,
                    game_id_bytes.as_ref(),
                    seat_byte.as_ref(),
                    &[hand_bump],
                ]])?;
        }

        // Evaluate winner
        let active_count = count_active_players(game);
        if active_count == 1 {
            for i in 0..player_count {
                let s = game.player_status[i];
                if s == PlayerStatus::Active as u8 || s == PlayerStatus::AllIn as u8 {
                    game.winner_index = i as u8;
                    break;
                }
            }
        } else {
            let mut hands: Vec<(u8, [u8; 2])> = Vec::with_capacity(player_count);
            for i in 0..player_count {
                let data = hand_accounts[i].try_borrow_data()?;
                let hand = [data[HAND_OFFSET], data[HAND_OFFSET + 1]];
                hands.push((game.player_status[i], hand));
            }
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

        game.exit(&crate::ID)?;

        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.game.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;

        Ok(())
    }

    /// Commit GameState back to L1 without running showdown logic.
    pub fn commit_game(ctx: Context<CommitGame>) -> Result<()> {
        ctx.accounts.game.exit(&crate::ID)?;

        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.game.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;

        Ok(())
    }

    // =========================================================================
    // TEST HELPERS (no delegation / no ER)
    // =========================================================================

    /// Test helper: create a game without setting up permissions or delegation.
    pub fn create_game_test(
        ctx: Context<CreateGameTest>,
        game_id: u64,
        table_id: u64,
        wager_tier: u64,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        game.game_id = game_id;
        game.table_id = table_id;
        game.player_count = 0;
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
            game.players[i] = Pubkey::default();
            game.player_status[i] = PlayerStatus::Empty as u8;
            game.player_bets[i] = 0;
        }

        Ok(())
    }

    /// Test helper: join a game — creates the PlayerHand without delegation.
    pub fn join_game_test(
        ctx: Context<JoinGameTest>,
        game_id: u64,
        seat_index: u8,
        player: Pubkey,
    ) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.phase == GamePhase::Waiting, GameError::InvalidPhase);
        require!(
            (seat_index as usize) < MAX_PLAYERS,
            GameError::InvalidSeatIndex
        );
        require!(
            game.player_status[seat_index as usize] == PlayerStatus::Empty as u8,
            GameError::SeatTaken
        );

        game.players[seat_index as usize] = player;
        game.player_status[seat_index as usize] = PlayerStatus::Active as u8;
        game.player_count += 1;

        let hand = &mut ctx.accounts.player_hand;
        hand.game_id = game_id;
        hand.player = player;
        hand.hand = [255u8; 2];
        hand.bump = ctx.bumps.player_hand;

        Ok(())
    }

    /// Test helper: deal cards from a pre-shuffled deck.
    /// Hand accounts are passed via remaining_accounts.
    pub fn deal_cards(ctx: Context<DealCards>, deck: Vec<u8>) -> Result<()> {
        require!(deck.len() == 52, GameError::InvalidDeck);
        let game = &mut ctx.accounts.game;
        require!(game.phase == GamePhase::Waiting, GameError::InvalidPhase);
        let player_count = game.player_count as usize;
        require!(player_count >= 2, GameError::InvalidPlayerCount);
        require!(
            ctx.remaining_accounts.len() == player_count,
            GameError::InvalidHandCount
        );

        let mut deck_arr = [0u8; 52];
        deck_arr.copy_from_slice(&deck);
        game.deck = deck_arr;

        let game_id_bytes = game.game_id.to_le_bytes();
        for i in 0..player_count {
            let hand_info = &ctx.remaining_accounts[i];
            verify_hand_pda(hand_info.key, &game_id_bytes, i as u8)?;
            let mut data = hand_info.try_borrow_mut_data()?;
            data[HAND_OFFSET] = deck_arr[i * 2];
            data[HAND_OFFSET + 1] = deck_arr[i * 2 + 1];
        }

        let c = player_count * 2;
        game.community_cards = [
            deck_arr[c],
            deck_arr[c + 1],
            deck_arr[c + 2],
            deck_arr[c + 3],
            deck_arr[c + 4],
        ];

        // Blinds
        let small_blind = game
            .wager_tier
            .checked_mul(SMALL_BLIND_RATIO)
            .ok_or(GameError::MathOverflow)?
            .checked_div(RATIO_BASE)
            .ok_or(GameError::MathOverflow)?;
        let big_blind = game
            .wager_tier
            .checked_mul(BIG_BLIND_RATIO)
            .ok_or(GameError::MathOverflow)?
            .checked_div(RATIO_BASE)
            .ok_or(GameError::MathOverflow)?;

        let sb_idx = ((game.dealer_index + 1) % game.player_count) as usize;
        let bb_idx = ((game.dealer_index + 2) % game.player_count) as usize;
        game.player_bets[sb_idx] = small_blind;
        game.player_bets[bb_idx] = big_blind;
        game.pot = small_blind
            .checked_add(big_blind)
            .ok_or(GameError::MathOverflow)?;
        game.current_bet = big_blind;

        let first = ((game.dealer_index + 3) % game.player_count) as usize;
        game.current_player = first as u8;
        game.last_raiser = bb_idx as u8;
        game.community_count = 0;
        game.phase = GamePhase::Preflop;
        game.last_action_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    /// Test helper: showdown without ER commit or permission updates.
    /// Hand accounts are passed via remaining_accounts.
    pub fn showdown_test(ctx: Context<ShowdownTest>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.phase == GamePhase::Showdown
                || count_active_players(game) <= 1
                || game.phase == GamePhase::River,
            GameError::InvalidPhase
        );

        let player_count = game.player_count as usize;
        let active_count = count_active_players(game);

        if active_count == 1 {
            for i in 0..player_count {
                let s = game.player_status[i];
                if s == PlayerStatus::Active as u8 || s == PlayerStatus::AllIn as u8 {
                    game.winner_index = i as u8;
                    break;
                }
            }
        } else {
            require!(
                ctx.remaining_accounts.len() == player_count,
                GameError::InvalidHandCount
            );

            let game_id_bytes = game.game_id.to_le_bytes();
            let mut hands: Vec<(u8, [u8; 2])> = Vec::with_capacity(player_count);
            for i in 0..player_count {
                let hand_info = &ctx.remaining_accounts[i];
                verify_hand_pda(hand_info.key, &game_id_bytes, i as u8)?;
                let data = hand_info.try_borrow_data()?;
                let hand = [data[HAND_OFFSET], data[HAND_OFFSET + 1]];
                hands.push((game.player_status[i], hand));
            }

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

        Ok(())
    }
}

// =============================================================================
// Helper functions
// =============================================================================

fn verify_hand_pda(key: &Pubkey, game_id_bytes: &[u8], seat: u8) -> Result<()> {
    let (expected, _) =
        Pubkey::find_program_address(&[HAND_SEED, game_id_bytes, &[seat]], &crate::ID);
    require!(*key == expected, GameError::InvalidHandAccount);
    Ok(())
}

fn count_non_folded_players(game: &GameState) -> u8 {
    let mut count = 0u8;
    for i in 0..game.player_count as usize {
        let s = game.player_status[i];
        if s == PlayerStatus::Active as u8 || s == PlayerStatus::AllIn as u8 {
            count += 1;
        }
    }
    count
}

fn count_strictly_active_players(game: &GameState) -> u8 {
    let mut count = 0u8;
    for i in 0..game.player_count as usize {
        if game.player_status[i] == PlayerStatus::Active as u8 {
            count += 1;
        }
    }
    count
}

fn count_active_players(game: &GameState) -> u8 {
    count_non_folded_players(game)
}

fn find_next_active_player(game: &GameState, from: usize) -> usize {
    let pc = game.player_count as usize;
    let mut idx = (from + 1) % pc;
    for _ in 0..pc {
        if game.player_status[idx] == PlayerStatus::Active as u8 {
            return idx;
        }
        idx = (idx + 1) % pc;
    }
    from
}

fn advance_phase(game: &mut GameState) -> Result<()> {
    match game.phase {
        GamePhase::Preflop => {
            game.phase = GamePhase::Flop;
            game.community_count = 3;
        }
        GamePhase::Flop => {
            game.phase = GamePhase::Turn;
            game.community_count = 4;
        }
        GamePhase::Turn => {
            game.phase = GamePhase::River;
            game.community_count = 5;
        }
        GamePhase::River => {
            game.phase = GamePhase::Showdown;
            return Ok(());
        }
        _ => return Err(GameError::InvalidPhase.into()),
    }

    for i in 0..game.player_count as usize {
        if game.player_status[i] == PlayerStatus::Active as u8 {
            game.player_bets[i] = 0;
        }
    }
    game.current_bet = 0;

    let first = find_next_active_player(game, game.dealer_index as usize);
    game.current_player = first as u8;
    game.last_raiser = first as u8;

    Ok(())
}

// =============================================================================
// Account data structures
// =============================================================================

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
    pub players: [Pubkey; 6],
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

impl GameState {
    pub const MAX_SIZE: usize =
        8 + 8 + 1 + 8 + 1 + 8 + 8 + 1 + 1 + 1 + 52 + (32 * 6) + 6 + (8 * 6) + 5 + 1 + 1 + 32
            + 1 + 8 + 8;
}

#[account]
pub struct PlayerHand {
    pub game_id: u64,
    pub player: Pubkey,
    pub hand: [u8; 2],
    pub bump: u8,
}

impl PlayerHand {
    pub const MAX_SIZE: usize = 8 + 32 + 2 + 1;
}

// =============================================================================
// Enums
// =============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum GamePhase {
    Waiting,
    Preflop,
    Flop,
    Turn,
    River,
    Showdown,
    Complete,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PlayerStatus {
    Empty = 0,
    Active = 1,
    Folded = 2,
    AllIn = 3,
}

#[derive(Clone, Copy)]
pub enum ActionType {
    Fold,
    Check,
    Call,
    Raise,
    AllIn,
}

impl ActionType {
    pub fn from_u8(val: u8) -> Result<Self> {
        match val {
            0 => Ok(ActionType::Fold),
            1 => Ok(ActionType::Check),
            2 => Ok(ActionType::Call),
            3 => Ok(ActionType::Raise),
            4 => Ok(ActionType::AllIn),
            _ => Err(GameError::InvalidAction.into()),
        }
    }
}

// =============================================================================
// Account context structs — PRODUCTION
// =============================================================================

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + GameState::MAX_SIZE,
        seeds = [GAME_SEED, game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, GameState>,

    /// CHECK: Permission PDA for GameState — validated by permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,

    /// CHECK: Delegation buffer for the permission PDA
    #[account(mut)]
    pub perm_delegation_buffer: AccountInfo<'info>,
    /// CHECK: Delegation record for the permission PDA
    #[account(mut)]
    pub perm_delegation_record: AccountInfo<'info>,
    /// CHECK: Delegation metadata for the permission PDA
    #[account(mut)]
    pub perm_delegation_metadata: AccountInfo<'info>,

    /// CHECK: TEE validator
    pub validator: AccountInfo<'info>,

    /// CHECK: MagicBlock permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,

    /// CHECK: MagicBlock delegation program
    pub delegation_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(game_id: u64, seat_index: u8)]
pub struct JoinGame<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.authority == payer.key() @ GameError::Unauthorized,
    )]
    pub game: Account<'info, GameState>,

    #[account(
        init,
        payer = payer,
        space = 8 + PlayerHand::MAX_SIZE,
        seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[seat_index]],
        bump,
        del,
    )]
    pub player_hand: Account<'info, PlayerHand>,

    /// CHECK: Permission PDA for the player hand
    #[account(mut)]
    pub hand_permission: UncheckedAccount<'info>,

    /// CHECK: Delegation buffer for the hand permission PDA
    #[account(mut)]
    pub perm_delegation_buffer: AccountInfo<'info>,
    /// CHECK: Delegation record for the hand permission PDA
    #[account(mut)]
    pub perm_delegation_record: AccountInfo<'info>,
    /// CHECK: Delegation metadata for the hand permission PDA
    #[account(mut)]
    pub perm_delegation_metadata: AccountInfo<'info>,

    /// CHECK: TEE validator
    pub validator: AccountInfo<'info>,

    /// CHECK: MagicBlock permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,

    /// CHECK: MagicBlock delegation program
    pub delegation_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct StartGame<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.authority == payer.key() @ GameError::Unauthorized,
        del,
    )]
    pub game: Account<'info, GameState>,

    /// CHECK: TEE validator
    pub validator: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[vrf]
#[derive(Accounts)]
#[instruction(client_seed: u8)]
pub struct RequestShuffle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        has_one = authority @ GameError::Unauthorized,
    )]
    pub game: Account<'info, GameState>,

    pub authority: Signer<'info>,

    /// CHECK: Oracle queue — must be the ephemeral queue for ER-delegated accounts
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
    // Hand accounts are passed via remaining_accounts
}

#[derive(Accounts)]
pub struct CallbackShuffle<'info> {
    /// SECURITY: Must be signed by the VRF program to prevent spoofed callbacks
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,

    #[account(mut)]
    pub game: Account<'info, GameState>,
    // Hand accounts are passed via remaining_accounts
}

#[derive(Accounts)]
pub struct PlayerAction<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        has_one = authority @ GameError::Unauthorized,
    )]
    pub game: Account<'info, GameState>,
}

#[commit]
#[derive(Accounts)]
pub struct Showdown<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, GameState>,

    /// CHECK: MagicBlock permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    // remaining_accounts: [hand_0 .. hand_N, perm_0 .. perm_N]
}

#[commit]
#[derive(Accounts)]
pub struct CommitGame<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, GameState>,
}

// =============================================================================
// Account context structs — TEST HELPERS
// =============================================================================

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGameTest<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + GameState::MAX_SIZE,
        seeds = [GAME_SEED, game_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub game: Account<'info, GameState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(game_id: u64, seat_index: u8)]
pub struct JoinGameTest<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        constraint = game.authority == authority.key() @ GameError::Unauthorized,
    )]
    pub game: Account<'info, GameState>,

    #[account(
        init,
        payer = authority,
        space = 8 + PlayerHand::MAX_SIZE,
        seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[seat_index]],
        bump,
    )]
    pub player_hand: Account<'info, PlayerHand>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DealCards<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
        has_one = authority @ GameError::Unauthorized,
    )]
    pub game: Account<'info, GameState>,
    // Hand accounts are passed via remaining_accounts
}

#[derive(Accounts)]
pub struct ShowdownTest<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, GameState>,
    // Hand accounts are passed via remaining_accounts
}

// =============================================================================
// Events
// =============================================================================

#[event]
pub struct GameFinished {
    pub game_id: u64,
    pub winner_index: u8,
    pub winner_pubkey: Pubkey,
    pub pot: u64,
}

// =============================================================================
// Errors
// =============================================================================

#[error_code]
pub enum GameError {
    #[msg("Invalid player count (must be 2-6)")]
    InvalidPlayerCount,
    #[msg("Invalid game phase for this action")]
    InvalidPhase,
    #[msg("Player is not active")]
    PlayerNotActive,
    #[msg("Cannot check when there is an outstanding bet")]
    CannotCheck,
    #[msg("Raise must be greater than current bet")]
    RaiseTooSmall,
    #[msg("Invalid action type")]
    InvalidAction,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Deck must be exactly 52 cards")]
    InvalidDeck,
    #[msg("Invalid seat index")]
    InvalidSeatIndex,
    #[msg("Seat is already taken")]
    SeatTaken,
    #[msg("Wrong number of hand accounts in remaining_accounts")]
    InvalidHandCount,
    #[msg("Hand account PDA does not match expected derivation")]
    InvalidHandAccount,
}
