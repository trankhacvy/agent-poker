use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::{
    CreatePermissionCpiBuilder, UpdatePermissionCpiBuilder,
    DelegatePermissionCpiBuilder
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
pub const SMALL_BLIND_RATIO: u64 = 50; // 5%  of wager_tier
pub const BIG_BLIND_RATIO: u64 = 100; // 10% of wager_tier
pub const RATIO_BASE: u64 = 1000;

#[ephemeral]
#[program]
pub mod agent_poker_game {
    use super::*;

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

        ctx.accounts.hand0.game_id = game_id;
        ctx.accounts.hand0.player = Pubkey::default();
        ctx.accounts.hand0.hand = [255u8; 2];
        ctx.accounts.hand0.bump = ctx.bumps.hand0;

        ctx.accounts.hand1.game_id = game_id;
        ctx.accounts.hand1.player = Pubkey::default();
        ctx.accounts.hand1.hand = [255u8; 2];
        ctx.accounts.hand1.bump = ctx.bumps.hand1;

        ctx.accounts.hand2.game_id = game_id;
        ctx.accounts.hand2.player = Pubkey::default();
        ctx.accounts.hand2.hand = [255u8; 2];
        ctx.accounts.hand2.bump = ctx.bumps.hand2;

        ctx.accounts.hand3.game_id = game_id;
        ctx.accounts.hand3.player = Pubkey::default();
        ctx.accounts.hand3.hand = [255u8; 2];
        ctx.accounts.hand3.bump = ctx.bumps.hand3;

        ctx.accounts.hand4.game_id = game_id;
        ctx.accounts.hand4.player = Pubkey::default();
        ctx.accounts.hand4.hand = [255u8; 2];
        ctx.accounts.hand4.bump = ctx.bumps.hand4;

        ctx.accounts.hand5.game_id = game_id;
        ctx.accounts.hand5.player = Pubkey::default();
        ctx.accounts.hand5.hand = [255u8; 2];
        ctx.accounts.hand5.bump = ctx.bumps.hand5;

        Ok(())
    }

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

        ctx.accounts.player_hand.player = player;

        let game_id_bytes = game_id.to_le_bytes();
        let seat_byte = [seat_index];
        let hand_bump = [ctx.accounts.player_hand.bump];
        let pda_signer_seeds: &[&[u8]] = &[
            HAND_SEED,
            game_id_bytes.as_ref(),
            seat_byte.as_ref(),
            hand_bump.as_ref(),
        ];

        let payer_info = ctx.accounts.payer.to_account_info();
        let hand_info = ctx.accounts.player_hand.to_account_info();
        let perm_info = ctx.accounts.permission.to_account_info();
        let sys_info = ctx.accounts.system_program.to_account_info();
        let perm_prog_info = ctx.accounts.permission_program.to_account_info();
        let deleg_prog_info = ctx.accounts.delegation_program.to_account_info();

        CreatePermissionCpiBuilder::new(&perm_prog_info)
            .permissioned_account(&hand_info)
            .permission(&perm_info)
            .payer(&payer_info)
            .system_program(&sys_info)
            .args(MembersArgs { members: None })
            .invoke_signed(&[pda_signer_seeds])?;

        DelegatePermissionCpiBuilder::new(&perm_prog_info)
            .payer(&payer_info)
            .authority(&hand_info, true)
            .permissioned_account(&hand_info, false)
            .permission(&perm_info)
            .system_program(&sys_info)
            .owner_program(&perm_prog_info)
            .delegation_buffer(&ctx.accounts.perm_delegation_buffer)
            .delegation_record(&ctx.accounts.perm_delegation_record)
            .delegation_metadata(&ctx.accounts.perm_delegation_metadata)
            .delegation_program(&deleg_prog_info)
            .validator(Some(&ctx.accounts.validator))
            .invoke_signed(&[pda_signer_seeds])?;

        ctx.accounts.player_hand.exit(&crate::ID)?;

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

    pub fn start_game(ctx: Context<StartGame>, game_id: u64) -> Result<()> {
        let game = &ctx.accounts.game;
        require!(game.phase == GamePhase::Waiting, GameError::InvalidPhase);
        require!(game.player_count >= 2, GameError::InvalidPlayerCount);

        let game_id_bytes = game_id.to_le_bytes();
        let game_bump = [game.bump];
        let pda_signer_seeds: &[&[u8]] =
            &[GAME_SEED, game_id_bytes.as_ref(), game_bump.as_ref()];

        let payer_info = ctx.accounts.payer.to_account_info();
        let game_info = ctx.accounts.game.to_account_info();
        let perm_info = ctx.accounts.permission.to_account_info();
        let sys_info = ctx.accounts.system_program.to_account_info();
        let perm_prog_info = ctx.accounts.permission_program.to_account_info();
        let deleg_prog_info = ctx.accounts.delegation_program.to_account_info();

        CreatePermissionCpiBuilder::new(&perm_prog_info)
            .permissioned_account(&game_info)
            .permission(&perm_info)
            .payer(&payer_info)
            .system_program(&sys_info)
            .args(MembersArgs { members: None })
            .invoke_signed(&[pda_signer_seeds])?;

        DelegatePermissionCpiBuilder::new(&perm_prog_info)
            .payer(&payer_info)
            .authority(&game_info, true)
            .permissioned_account(&game_info, false)
            .permission(&perm_info)
            .system_program(&sys_info)
            .owner_program(&perm_prog_info)
            .delegation_buffer(&ctx.accounts.perm_delegation_buffer)
            .delegation_record(&ctx.accounts.perm_delegation_record)
            .delegation_metadata(&ctx.accounts.perm_delegation_metadata)
            .delegation_program(&deleg_prog_info)
            .validator(Some(&ctx.accounts.validator))
            .invoke_signed(&[pda_signer_seeds])?;

        ctx.accounts.game.exit(&crate::ID)?;

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

    pub fn create_game_test(
        ctx: Context<CreateGameTest>,
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

        let player_keys: [Pubkey; 6] = core::array::from_fn(|i| {
            if i < player_count {
                players[i]
            } else {
                Pubkey::default()
            }
        });

        ctx.accounts.hand0.game_id = game_id;
        ctx.accounts.hand0.player = player_keys[0];
        ctx.accounts.hand0.hand = [255u8; 2];
        ctx.accounts.hand0.bump = ctx.bumps.hand0;

        ctx.accounts.hand1.game_id = game_id;
        ctx.accounts.hand1.player = player_keys[1];
        ctx.accounts.hand1.hand = [255u8; 2];
        ctx.accounts.hand1.bump = ctx.bumps.hand1;

        ctx.accounts.hand2.game_id = game_id;
        ctx.accounts.hand2.player = player_keys[2];
        ctx.accounts.hand2.hand = [255u8; 2];
        ctx.accounts.hand2.bump = ctx.bumps.hand2;

        ctx.accounts.hand3.game_id = game_id;
        ctx.accounts.hand3.player = player_keys[3];
        ctx.accounts.hand3.hand = [255u8; 2];
        ctx.accounts.hand3.bump = ctx.bumps.hand3;

        ctx.accounts.hand4.game_id = game_id;
        ctx.accounts.hand4.player = player_keys[4];
        ctx.accounts.hand4.hand = [255u8; 2];
        ctx.accounts.hand4.bump = ctx.bumps.hand4;

        ctx.accounts.hand5.game_id = game_id;
        ctx.accounts.hand5.player = player_keys[5];
        ctx.accounts.hand5.hand = [255u8; 2];
        ctx.accounts.hand5.bump = ctx.bumps.hand5;

        Ok(())
    }

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

    pub fn create_permission(
        ctx: Context<CreatePermission>,
        account_type: AccountType,
        members: Option<Vec<Member>>,
    ) -> Result<()> {
        let CreatePermission {
            permissioned_account,
            permission,
            payer,
            permission_program,
            system_program,
        } = ctx.accounts;

        let seed_data = derive_seeds(&account_type);
        let (_, bump) = Pubkey::find_program_address(
            &seed_data.iter().map(|s| s.as_slice()).collect::<Vec<_>>(),
            &crate::ID,
        );

        let mut seeds = seed_data.clone();
        seeds.push(vec![bump]);
        let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();

        CreatePermissionCpiBuilder::new(&permission_program)
            .permissioned_account(&permissioned_account.to_account_info())
            .permission(&permission)
            .payer(&payer)
            .system_program(&system_program)
            .args(MembersArgs { members })
            .invoke_signed(&[seed_refs.as_slice()])?;

        Ok(())
    }

    pub fn request_shuffle(ctx: Context<RequestShuffle>, client_seed: u8) -> Result<()> {
        require!(
            ctx.accounts.game.phase == GamePhase::Waiting,
            GameError::InvalidPhase
        );

        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackShuffle::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![
                SerializableAccountMeta {
                    pubkey: ctx.accounts.game.key(),
                    is_signer: false,
                    is_writable: true,
                },
                SerializableAccountMeta {
                    pubkey: ctx.accounts.hand0.key(),
                    is_signer: false,
                    is_writable: true,
                },
                SerializableAccountMeta {
                    pubkey: ctx.accounts.hand1.key(),
                    is_signer: false,
                    is_writable: true,
                },
                SerializableAccountMeta {
                    pubkey: ctx.accounts.hand2.key(),
                    is_signer: false,
                    is_writable: true,
                },
                SerializableAccountMeta {
                    pubkey: ctx.accounts.hand3.key(),
                    is_signer: false,
                    is_writable: true,
                },
                SerializableAccountMeta {
                    pubkey: ctx.accounts.hand4.key(),
                    is_signer: false,
                    is_writable: true,
                },
                SerializableAccountMeta {
                    pubkey: ctx.accounts.hand5.key(),
                    is_signer: false,
                    is_writable: true,
                },
            ]),
            ..Default::default()
        });

        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    pub fn callback_shuffle(ctx: Context<CallbackShuffle>, randomness: [u8; 32]) -> Result<()> {
        let game = &mut ctx.accounts.game;

        let mut deck = [0u8; 52];
        for i in 0..52u8 {
            deck[i as usize] = i;
        }

        for i in (1..52usize).rev() {
            let j = ephemeral_vrf_sdk::rnd::random_u8_with_range(&randomness, 0, i as u8) as usize;
            deck.swap(i, j);
        }

        game.deck = deck;

        ctx.accounts.hand0.hand = [deck[0], deck[1]];
        ctx.accounts.hand1.hand = [deck[2], deck[3]];
        ctx.accounts.hand2.hand = [deck[4], deck[5]];
        ctx.accounts.hand3.hand = [deck[6], deck[7]];
        ctx.accounts.hand4.hand = [deck[8], deck[9]];
        ctx.accounts.hand5.hand = [deck[10], deck[11]];

        game.community_cards = [deck[12], deck[13], deck[14], deck[15], deck[16]];

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

    pub fn player_action(ctx: Context<PlayerAction>, action: u8, raise_amount: u64) -> Result<()> {
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

    pub fn showdown(ctx: Context<Showdown>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.phase == GamePhase::Showdown
                || count_active_players(game) <= 1
                || game.phase == GamePhase::River,
            GameError::InvalidPhase
        );

        let permission_program = &ctx.accounts.permission_program.to_account_info();

        let hand_infos = [
            (&ctx.accounts.hand0, &ctx.accounts.permission_hand0),
            (&ctx.accounts.hand1, &ctx.accounts.permission_hand1),
            (&ctx.accounts.hand2, &ctx.accounts.permission_hand2),
            (&ctx.accounts.hand3, &ctx.accounts.permission_hand3),
            (&ctx.accounts.hand4, &ctx.accounts.permission_hand4),
            (&ctx.accounts.hand5, &ctx.accounts.permission_hand5),
        ];

        for (i, (hand_acc, perm_acc)) in hand_infos.iter().enumerate() {
            if game.player_status[i] == PlayerStatus::Empty as u8 {
                continue;
            }
            let game_id_bytes = game.game_id.to_le_bytes();
            let seat_byte = [i as u8];
            let hand_bump = hand_acc.bump;
            UpdatePermissionCpiBuilder::new(permission_program)
                .permissioned_account(&hand_acc.to_account_info(), true)
                .authority(&hand_acc.to_account_info(), false)
                .permission(&perm_acc.to_account_info())
                .args(MembersArgs { members: None })
                .invoke_signed(&[&[
                    HAND_SEED,
                    game_id_bytes.as_ref(),
                    seat_byte.as_ref(),
                    &[hand_bump],
                ]])?;
        }

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

        game.exit(&crate::ID)?;

        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&ctx.accounts.game.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;

        Ok(())
    }

    pub fn deal_cards(ctx: Context<DealCards>, deck: Vec<u8>) -> Result<()> {
        require!(deck.len() == 52, GameError::InvalidDeck);
        let game = &mut ctx.accounts.game;
        require!(game.phase == GamePhase::Waiting, GameError::InvalidPhase);

        let mut deck_arr = [0u8; 52];
        deck_arr.copy_from_slice(&deck);
        game.deck = deck_arr;

        ctx.accounts.hand0.hand = [deck_arr[0], deck_arr[1]];
        ctx.accounts.hand1.hand = [deck_arr[2], deck_arr[3]];
        ctx.accounts.hand2.hand = [deck_arr[4], deck_arr[5]];
        ctx.accounts.hand3.hand = [deck_arr[6], deck_arr[7]];
        ctx.accounts.hand4.hand = [deck_arr[8], deck_arr[9]];
        ctx.accounts.hand5.hand = [deck_arr[10], deck_arr[11]];

        game.community_cards = [deck_arr[12], deck_arr[13], deck_arr[14], deck_arr[15], deck_arr[16]];

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

        let first = ((game.dealer_index + 3) % game.player_count) as usize;
        game.current_player = first as u8;
        game.last_raiser = bb_idx as u8;
        game.community_count = 0;
        game.phase = GamePhase::Preflop;
        game.last_action_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn showdown_test(ctx: Context<ShowdownTest>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.phase == GamePhase::Showdown
                || count_active_players(game) <= 1
                || game.phase == GamePhase::River,
            GameError::InvalidPhase
        );

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

        Ok(())
    }

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

fn derive_seeds(account_type: &AccountType) -> Vec<Vec<u8>> {
    match account_type {
        AccountType::Game { game_id } => {
            vec![GAME_SEED.to_vec(), game_id.to_le_bytes().to_vec()]
        }
        AccountType::PlayerHand {
            game_id,
            seat_index,
        } => {
            vec![
                HAND_SEED.to_vec(),
                game_id.to_le_bytes().to_vec(),
                vec![*seat_index],
            ]
        }
    }
}

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
    pub const MAX_SIZE: usize = 8 + 8 + 1 + 8 + 1 + 8 + 8 + 1 + 1 + 1
        + 52 + (32 * 6) + 6 + (8 * 6) + 5 + 1 + 1 + 32 + 1 + 8 + 8;
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AccountType {
    Game { game_id: u64 },
    PlayerHand { game_id: u64, seat_index: u8 },
}

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
        mut,
        seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[seat_index]],
        bump = player_hand.bump,
        del,
    )]
    pub player_hand: Account<'info, PlayerHand>,

    /// CHECK: Permission PDA for the player hand — validated by permission program
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

    /// CHECK: Permission PDA for the game — validated by permission program
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

    pub system_program: Program<'info, System>,
}

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

    #[account(
        init,
        payer = authority,
        space = 8 + PlayerHand::MAX_SIZE,
        seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[0u8]],
        bump,
    )]
    pub hand0: Account<'info, PlayerHand>,
    #[account(
        init,
        payer = authority,
        space = 8 + PlayerHand::MAX_SIZE,
        seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[1u8]],
        bump,
    )]
    pub hand1: Account<'info, PlayerHand>,
    #[account(
        init,
        payer = authority,
        space = 8 + PlayerHand::MAX_SIZE,
        seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[2u8]],
        bump,
    )]
    pub hand2: Account<'info, PlayerHand>,
    #[account(
        init,
        payer = authority,
        space = 8 + PlayerHand::MAX_SIZE,
        seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[3u8]],
        bump,
    )]
    pub hand3: Account<'info, PlayerHand>,
    #[account(
        init,
        payer = authority,
        space = 8 + PlayerHand::MAX_SIZE,
        seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[4u8]],
        bump,
    )]
    pub hand4: Account<'info, PlayerHand>,
    #[account(
        init,
        payer = authority,
        space = 8 + PlayerHand::MAX_SIZE,
        seeds = [HAND_SEED, game_id.to_le_bytes().as_ref(), &[5u8]],
        bump,
    )]
    pub hand5: Account<'info, PlayerHand>,

    pub system_program: Program<'info, System>,
}

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

    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[0u8]], bump)]
    pub hand0: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[1u8]], bump)]
    pub hand1: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[2u8]], bump)]
    pub hand2: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[3u8]], bump)]
    pub hand3: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[4u8]], bump)]
    pub hand4: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[5u8]], bump)]
    pub hand5: Account<'info, PlayerHand>,
}

#[derive(Accounts)]
pub struct CallbackShuffle<'info> {
    /// SECURITY: Must be signed by the VRF program to prevent spoofed callbacks
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,

    #[account(mut)]
    pub game: Account<'info, GameState>,

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

    /// CHECK: Permission PDA for hand0
    #[account(mut)]
    pub permission_hand0: UncheckedAccount<'info>,
    /// CHECK: Permission PDA for hand1
    #[account(mut)]
    pub permission_hand1: UncheckedAccount<'info>,
    /// CHECK: Permission PDA for hand2
    #[account(mut)]
    pub permission_hand2: UncheckedAccount<'info>,
    /// CHECK: Permission PDA for hand3
    #[account(mut)]
    pub permission_hand3: UncheckedAccount<'info>,
    /// CHECK: Permission PDA for hand4
    #[account(mut)]
    pub permission_hand4: UncheckedAccount<'info>,
    /// CHECK: Permission PDA for hand5
    #[account(mut)]
    pub permission_hand5: UncheckedAccount<'info>,

    /// CHECK: MagicBlock permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
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
pub struct ShowdownTest<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref()],
        bump = game.bump,
    )]
    pub game: Account<'info, GameState>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[0u8]], bump)]
    pub hand0: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[1u8]], bump)]
    pub hand1: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[2u8]], bump)]
    pub hand2: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[3u8]], bump)]
    pub hand3: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[4u8]], bump)]
    pub hand4: Account<'info, PlayerHand>,
    #[account(seeds = [HAND_SEED, game.game_id.to_le_bytes().as_ref(), &[5u8]], bump)]
    pub hand5: Account<'info, PlayerHand>,
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

#[event]
pub struct GameFinished {
    pub game_id: u64,
    pub winner_index: u8,
    pub winner_pubkey: Pubkey,
    pub pot: u64,
}

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
}
