# ➕ Pinocchio Counter

Simple counter program using Pinocchio and Ephemeral Rollups.

This is a port of the Rust Counter program to use Pinocchio instead of Borsh for serialization, eliminating the need for Vec types.

## Software Packages

| Software | Version | Installation Guide |
| -------- | ------- | ------------------- |
| **Solana** | 2.3.13 | [Install Solana](https://docs.anza.xyz/cli/install) |
| **Rust** | 1.85.0 | [Install Rust](https://www.rust-lang.org/tools/install) |
| **Node** | 24.10.0 | [Install Node](https://nodejs.org/en/download/current) |

## Build

```bash
cargo build-sbf
```

## Test

```bash
cargo test-sbf --features logging
```

## Key Differences from Rust Counter

- **No Borsh**: Uses manual serialization with `to_le_bytes()` and `from_le_bytes()` for simplicity
- **No Vec**: All types use fixed-size arrays or primitives
- **Pinocchio Framework**: Leverages Pinocchio's lightweight instruction handling
- **Direct State Management**: Simple `Counter` struct with manual serialization

## Instructions

### 0: InitializeCounter
Initialize a counter PDA to 0. Payload: `bump` (u8).

### 1: IncreaseCounter
Increase the counter by a specified amount. Payload: `bump` (u8) + `increase_by` (u64).

### 2: Delegate
Delegate the counter account to the Ephemeral Rollups delegation program. Payload: `bump` (u8).

### 3: CommitAndUndelegate
Commit changes and undelegate the counter account.

### 4: Commit
Commit changes to the base layer.

### 5: IncrementAndCommit
Increment counter and commit in one instruction. Payload: `bump` (u8) + `increase_by` (u64).

### 6: IncrementAndUndelegate
Increment counter and undelegate in one instruction. Payload: `bump` (u8) + `increase_by` (u64).

## Account Structure

- **Counter**: 8 bytes (u64 count value)



// lib.rs
#![no_std]
#![allow(unexpected_cfgs)]

mod entrypoint;
mod processor;
mod state;

pub use crate::entrypoint::process_instruction;

// entrypoint.rs
use crate::processor::{
    process_commit, process_commit_and_undelegate, process_delegate, process_increase_counter,
    process_increment_commit, process_increment_undelegate, process_initialize_counter,
    process_undelegation_callback,
};
use core::{mem::MaybeUninit, slice::from_raw_parts};
use pinocchio::{
    entrypoint::deserialize, error::ProgramError, no_allocator, nostd_panic_handler, AccountView,
    Address, ProgramResult, MAX_TX_ACCOUNTS, SUCCESS,
};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum InstructionDiscriminator {
    InitializeCounter,
    IncreaseCounter,
    Delegate,
    CommitAndUndelegate,
    Commit,
    IncrementAndCommit,
    IncrementAndUndelegate,
    UndelegationCallback,
}

impl InstructionDiscriminator {
    const INITIALIZE_COUNTER: [u8; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
    const INCREASE_COUNTER: [u8; 8] = [1, 0, 0, 0, 0, 0, 0, 0];
    const DELEGATE: [u8; 8] = [2, 0, 0, 0, 0, 0, 0, 0];
    const COMMIT_AND_UNDELEGATE: [u8; 8] = [3, 0, 0, 0, 0, 0, 0, 0];
    const COMMIT: [u8; 8] = [4, 0, 0, 0, 0, 0, 0, 0];
    const INCREMENT_AND_COMMIT: [u8; 8] = [5, 0, 0, 0, 0, 0, 0, 0];
    const INCREMENT_AND_UNDELEGATE: [u8; 8] = [6, 0, 0, 0, 0, 0, 0, 0];
    // Undelegation callback called by the delegation program
    const UNDELEGATION_CALLBACK: [u8; 8] = [196, 28, 41, 206, 48, 37, 51, 167];

    fn from_bytes(bytes: [u8; 8]) -> Result<Self, ProgramError> {
        match bytes {
            Self::INITIALIZE_COUNTER => Ok(Self::InitializeCounter),
            Self::INCREASE_COUNTER => Ok(Self::IncreaseCounter),
            Self::DELEGATE => Ok(Self::Delegate),
            Self::COMMIT_AND_UNDELEGATE => Ok(Self::CommitAndUndelegate),
            Self::COMMIT => Ok(Self::Commit),
            Self::INCREMENT_AND_COMMIT => Ok(Self::IncrementAndCommit),
            Self::INCREMENT_AND_UNDELEGATE => Ok(Self::IncrementAndUndelegate),
            Self::UNDELEGATION_CALLBACK => Ok(Self::UndelegationCallback),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

// Do not allocate memory.
no_allocator!();
// Use the no_std panic handler.
nostd_panic_handler!();

#[no_mangle]
#[allow(clippy::arithmetic_side_effects)]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
    const UNINIT: MaybeUninit<AccountView> = MaybeUninit::<AccountView>::uninit();
    let mut accounts = [UNINIT; { MAX_TX_ACCOUNTS }];

    let (program_id, count, instruction_data) =
        deserialize::<MAX_TX_ACCOUNTS>(input, &mut accounts);

    match process_instruction(
        program_id,
        from_raw_parts(accounts.as_ptr() as _, count),
        instruction_data,
    ) {
        Ok(()) => SUCCESS,
        Err(error) => error.into(),
    }
}

/// Log an error.
#[cold]
fn log_error(_error: &ProgramError) {
    #[cfg(feature = "logging")]
    pinocchio_log::log!("Program error");
}

/// Process an instruction.
#[inline(always)]
pub fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    let result = inner_process_instruction(program_id, accounts, instruction_data);
    result.inspect_err(log_error)
}

/// Process an instruction.
#[inline(always)]
pub(crate) fn inner_process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let discriminator: [u8; 8] = instruction_data[..8]
        .try_into()
        .map_err(|_| ProgramError::InvalidInstructionData)?;
    let discriminator = InstructionDiscriminator::from_bytes(discriminator)?;
    let payload = &instruction_data[8..];

    log_instruction(discriminator);

    match discriminator {
        InstructionDiscriminator::InitializeCounter => {
            let bump = read_u8(payload)?;
            process_initialize_counter(program_id, accounts, bump)
        }
        InstructionDiscriminator::IncreaseCounter => {
            let (bump, increase_by) = read_bump_and_u64(payload)?;
            process_increase_counter(program_id, accounts, bump, increase_by)
        }
        InstructionDiscriminator::Delegate => {
            let bump = read_u8(payload)?;
            process_delegate(program_id, accounts, bump)
        }
        InstructionDiscriminator::CommitAndUndelegate => {
            process_commit_and_undelegate(program_id, accounts)
        }
        InstructionDiscriminator::Commit => process_commit(program_id, accounts),
        InstructionDiscriminator::IncrementAndCommit => {
            let (bump, increase_by) = read_bump_and_u64(payload)?;
            process_increment_commit(program_id, accounts, bump, increase_by)
        }
        InstructionDiscriminator::IncrementAndUndelegate => {
            let (bump, increase_by) = read_bump_and_u64(payload)?;
            process_increment_undelegate(program_id, accounts, bump, increase_by)
        }
        InstructionDiscriminator::UndelegationCallback => {
            process_undelegation_callback(program_id, accounts, payload)
        }
    }
}

fn read_u64(input: &[u8]) -> Result<u64, ProgramError> {
    if input.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&input[..8]);
    Ok(u64::from_le_bytes(bytes))
}

fn read_u8(input: &[u8]) -> Result<u8, ProgramError> {
    if input.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    Ok(input[0])
}

fn read_bump_and_u64(input: &[u8]) -> Result<(u8, u64), ProgramError> {
    if input.len() < 9 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let bump = read_u8(input)?;
    let value = read_u64(&input[1..])?;
    Ok((bump, value))
}

#[allow(unused_variables)]
fn log_instruction(discriminator: InstructionDiscriminator) {
    #[cfg(feature = "logging")]
    {
        match discriminator {
            InstructionDiscriminator::InitializeCounter => {
                pinocchio_log::log!("InitializeCounter");
            }
            InstructionDiscriminator::IncreaseCounter => {
                pinocchio_log::log!("IncreaseCounter");
            }
            InstructionDiscriminator::Delegate => {
                pinocchio_log::log!("Delegate");
            }
            InstructionDiscriminator::CommitAndUndelegate => {
                pinocchio_log::log!("CommitAndUndelegate");
            }
            InstructionDiscriminator::Commit => {
                pinocchio_log::log!("Commit");
            }
            InstructionDiscriminator::IncrementAndCommit => {
                pinocchio_log::log!("IncrementAndCommit");
            }
            InstructionDiscriminator::IncrementAndUndelegate => {
                pinocchio_log::log!("IncrementAndUndelegate");
            }
            InstructionDiscriminator::UndelegationCallback => {
                pinocchio_log::log!("UndelegationCallback");
            }
        }
    }
}


// processor.rs
use crate::state::Counter;
use ephemeral_rollups_pinocchio::acl::{
    commit_and_undelegate_permission, CreatePermissionCpiBuilder, DelegatePermissionCpiBuilder,
    Member, MemberFlags, MembersArgs,
};
use ephemeral_rollups_pinocchio::instruction::delegate_account;
use ephemeral_rollups_pinocchio::instruction::{
    commit_accounts, commit_and_undelegate_accounts, undelegate,
};
use ephemeral_rollups_pinocchio::types::DelegateConfig;
use pinocchio::{
    account::AccountView,
    cpi::{Seed, Signer},
    error::ProgramError,
    Address, ProgramResult,
};
use pinocchio_log::log;
use pinocchio_system::instructions::CreateAccount;

/// Derive the counter PDA from the caller-provided bump.
fn counter_address_from_bump(
    program_id: &Address,
    initializer: &AccountView,
    bump: u8,
) -> Result<Address, ProgramError> {
    let bump_seed = [bump];
    #[cfg(any(target_os = "solana", target_arch = "bpf"))]
    {
        Address::create_program_address(
            &[b"counter", initializer.address().as_ref(), &bump_seed],
            program_id,
        )
        .map_err(|_| ProgramError::InvalidArgument)
    }
    #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
    {
        use solana_pubkey::Pubkey;
        let program_pubkey = Pubkey::new_from_array(*program_id.as_array());
        let initializer_pubkey = Pubkey::new_from_array(*initializer.address().as_array());
        let pda = Pubkey::create_program_address(
            &[b"counter", initializer_pubkey.as_ref(), &bump_seed],
            &program_pubkey,
        )
        .map_err(|_| ProgramError::InvalidArgument)?;
        Ok(Address::new_from_array(pda.to_bytes()))
    }
}

/// Create and initialize the counter PDA for the initializer.
pub fn process_initialize_counter(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
) -> ProgramResult {
    let [initializer_account, counter_account, system_program, permission_program, permission, delegation_buffer, delegation_record, delegation_metadata, _delegation_program, validator] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let bump_seed = [bump];
    let counter_pda = counter_address_from_bump(program_id, initializer_account, bump)?;

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    // Counter signer seeds
    let seeds_array: [Seed; 3] = [
        Seed::from(b"counter"),
        Seed::from(initializer_account.address().as_ref()),
        Seed::from(&bump_seed),
    ];

    // Signer with bump
    let signer = Signer::from(&seeds_array);

    // Create counter account if it doesn't exist.
    if counter_account.lamports() == 0 {
        log!("Creating counter ...");
        let rent_exempt_lamports = 1_000_000;

        let create_account_ix = CreateAccount {
            from: initializer_account,
            to: counter_account,
            lamports: rent_exempt_lamports,
            space: Counter::SIZE as u64,
            owner: program_id,
        };
        create_account_ix
            .invoke_signed(&[signer.clone()])
            .map_err(|_| {
                log!("Counter creation failed with error");
                ProgramError::Custom(100)
            })?;
        log!("Counter created successfully");
    }

    // Initialize counter to 0.
    {
        let mut data = counter_account.try_borrow_mut()?;
        let counter_data = Counter::load_mut(&mut data)?;
        counter_data.count = 0;
    } // Explicitly drop borrow before CPI

    // Create permission for the counter account if it doesn't already exist
    if permission.lamports() == 0 {
        log!("Creating permission ...");
        let members_array = [Member {
            flags: MemberFlags::default(),
            pubkey: *initializer_account.address(),
        }];
        let members_args = MembersArgs {
            members: Some(&members_array),
        };
        let result = CreatePermissionCpiBuilder::new(
            counter_account,
            permission,
            initializer_account,
            system_program,
            &permission_program.address(),
        )
        .members(members_args)
        .seeds(&[b"counter", initializer_account.address().as_ref()])
        .bump(bump)
        .invoke();
        match result {
            Ok(_) => {
                log!("Permission created successfully");
            }
            Err(e) => {
                log!("Permission creation failed");
                // Try to log error code if available
                match e {
                    ProgramError::Custom(_code) => {
                        log!("Custom error code");
                    }
                    ProgramError::InvalidArgument => {
                        log!("InvalidArgument error");
                    }
                    ProgramError::InvalidAccountData => {
                        log!("InvalidAccountData error");
                    }
                    ProgramError::NotEnoughAccountKeys => {
                        log!("NotEnoughAccountKeys error");
                    }
                    _ => {
                        log!("Other error type");
                    }
                }
                return Err(e);
            }
        }
    } else {
        log!("Permission account already exists, skipping creation");
    }

    // Delegate permisison if not delegated
    if unsafe { permission.owner() } == permission_program.address() {
        log!("Delegating permission");
        let result = DelegatePermissionCpiBuilder::new(
            &initializer_account,
            &initializer_account,
            &counter_account,
            &permission,
            &system_program,
            &permission_program,
            &delegation_buffer,
            &delegation_record,
            &delegation_metadata,
            &_delegation_program,
            validator,
            permission_program.address(),
        )
        .signer_seeds(signer.clone())
        .invoke();

        match result {
            Ok(_) => {
                log!("Permission delegated successfully");
            }
            Err(e) => {
                log!("Permission delegation failed");
                // Try to log error code if available
                match e {
                    ProgramError::Custom(_code) => {
                        log!("Custom error code");
                    }
                    ProgramError::InvalidArgument => {
                        log!("InvalidArgument error");
                    }
                    ProgramError::InvalidAccountData => {
                        log!("InvalidAccountData error");
                    }
                    ProgramError::NotEnoughAccountKeys => {
                        log!("NotEnoughAccountKeys error");
                    }
                    _ => {
                        log!("Other error type");
                    }
                }
                return Err(e);
            }
        }
    } else {
        log!("Permission already delegated");
    }
    Ok(())
}

/// Increase the counter PDA by the requested amount.
pub fn process_increase_counter(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
    increase_by: u64,
) -> ProgramResult {
    let [initializer_account, counter_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let counter_pda = counter_address_from_bump(program_id, initializer_account, bump)?;

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    {
        let mut data = counter_account.try_borrow_mut()?;
        let counter_data = Counter::load_mut(&mut data)?;
        counter_data.count = counter_data
            .count
            .checked_add(increase_by)
            .ok_or(ProgramError::ArithmeticOverflow)?;
    }

    Ok(())
}

/// Delegate the counter PDA to the delegation program.
pub fn process_delegate(
    _program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
) -> ProgramResult {
    let [initializer, pda_to_delegate, owner_program, delegation_buffer, delegation_record, delegation_metadata, _delegation_program, system_program, rest @ ..] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let validator = rest.first().map(|account| *account.address());
    let permission = rest.get(1).ok_or(ProgramError::NotEnoughAccountKeys)?;
    let permission_program = rest.get(2).ok_or(ProgramError::NotEnoughAccountKeys)?;

    let seed_1 = b"counter";
    let seed_2 = initializer.address().as_ref();
    let seeds: &[&[u8]] = &[seed_1, seed_2];
    let counter_pda = counter_address_from_bump(owner_program.address(), initializer, bump)?;

    let delegate_config = DelegateConfig {
        validator,
        ..Default::default()
    };

    if counter_pda != *pda_to_delegate.address() {
        return Err(ProgramError::InvalidArgument);
    }

    // Verify permission was created and delegated before delegating counter
    log!("Checking permission delegation status");
    if unsafe { permission.owner() } == permission_program.address() {
        log!("Permission not delegated, cannot delegate counter");
        return Err(ProgramError::Custom(4));
    }
    log!("Permission verified as delegated, proceeding with counter delegation");

    delegate_account(
        &[
            initializer,
            pda_to_delegate,
            owner_program,
            delegation_buffer,
            delegation_record,
            delegation_metadata,
            system_program,
        ],
        seeds,
        bump,
        delegate_config,
    )?;

    Ok(())
}

/// Commit the counter PDA state to the base layer.
pub fn process_commit(_program_id: &Address, accounts: &[AccountView]) -> ProgramResult {
    let [initializer, counter_account, magic_program, magic_context] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !initializer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    commit_accounts(
        initializer,
        &[*counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

/// Commit the counter PDA state and undelegate it.
pub fn process_commit_and_undelegate(
    _program_id: &Address,
    accounts: &[AccountView],
) -> ProgramResult {
    let [initializer, counter_account, permission_program, permission, magic_program, magic_context] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !initializer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (counter_pda, bump_seed) =
        Address::find_program_address(&[b"counter", initializer.address().as_ref()], _program_id);

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    // Prepare signer seeds
    let seed_array: [Seed; 3] = [
        Seed::from(b"counter"),
        Seed::from(initializer.address().as_ref()),
        Seed::from(core::slice::from_ref(&bump_seed)),
    ];
    let signer_seeds = Signer::from(&seed_array);

    commit_and_undelegate_accounts(
        initializer,
        &[*counter_account],
        magic_context,
        magic_program,
    )?;

    commit_and_undelegate_permission(
        &[
            initializer,
            counter_account,
            permission,
            magic_program,
            magic_context,
        ],
        permission_program.address(),
        true,
        true,
        Some(signer_seeds.clone()),
    )?;

    Ok(())
}

/// Increment the counter PDA and commit in a single instruction.
pub fn process_increment_commit(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
    increase_by: u64,
) -> ProgramResult {
    let [initializer, counter_account, magic_program, magic_context] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let counter_pda = counter_address_from_bump(program_id, initializer, bump)?;

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    {
        let mut data = counter_account.try_borrow_mut()?;
        let counter_data = Counter::load_mut(&mut data)?;
        counter_data.count += increase_by;
    }

    if !initializer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    commit_accounts(
        initializer,
        &[*counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

/// Increment the counter PDA and commit+undelegate in a single instruction.
pub fn process_increment_undelegate(
    program_id: &Address,
    accounts: &[AccountView],
    bump: u8,
    increase_by: u64,
) -> ProgramResult {
    let [initializer, counter_account, magic_program, magic_context] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    let counter_pda = counter_address_from_bump(program_id, initializer, bump)?;

    if counter_pda != *counter_account.address() {
        return Err(ProgramError::InvalidArgument);
    }

    let mut data = counter_account.try_borrow_mut()?;
    let counter_data = Counter::load_mut(&mut data)?;
    counter_data.count += increase_by;

    if !initializer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    commit_and_undelegate_accounts(
        initializer,
        &[*counter_account],
        magic_context,
        magic_program,
    )?;

    Ok(())
}

/// Handle the callback emitted by the delegation program on undelegation.
pub fn process_undelegation_callback(
    program_id: &Address,
    accounts: &[AccountView],
    ix_data: &[u8],
) -> ProgramResult {
    let [delegated_acc, buffer_acc, payer, _system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    undelegate(delegated_acc, program_id, buffer_acc, payer, ix_data)?;
    Ok(())
}

// state
use pinocchio::error::ProgramError;

// State structure for the counter
#[repr(C)]
pub struct Counter {
    pub count: u64,
}

impl Counter {
    pub const SIZE: usize = 8;

    pub fn load_mut(data: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if data.len() < Self::SIZE {
            return Err(ProgramError::InvalidArgument);
        }
        let ptr = data.as_mut_ptr() as *mut Self;
        #[allow(clippy::manual_is_multiple_of)]
        if (ptr as usize) % core::mem::align_of::<Self>() != 0 {
            return Err(ProgramError::InvalidAccountData);
        }
        // Safety: caller ensures the account data is valid for Counter.
        Ok(unsafe { &mut *ptr })
    }
}
