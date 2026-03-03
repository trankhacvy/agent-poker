import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
// @ts-ignore -- bn.js lacks type declarations in this setup
import BN from "bn.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GameStateSnapshot, PlayerSnapshot } from "./types.js";
import gameIdl from "../../../target/idl/agent_poker_game.json";
import agentIdl from "../../../target/idl/agent_poker_agent.json";
import {
  DEFAULT_VALIDATOR,
  DELEGATION_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  permissionPdaFromAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const PROGRAM_ID = new PublicKey(gameIdl.address);
const AGENT_PROGRAM_ID = new PublicKey(agentIdl.address);
const ER_VALIDATOR = new PublicKey(DEFAULT_VALIDATOR);

const GAME_SEED = Buffer.from("poker_game");
const HAND_SEED = Buffer.from("player_hand");
const AGENT_SEED = Buffer.from("agent");

const STATUS_MAP: Record<number, PlayerSnapshot["status"]> = {
  0: "empty",
  1: "active",
  2: "folded",
  3: "all_in",
};

const PHASE_VARIANT_MAP: Record<string, string> = {
  waiting: "waiting",
  preflop: "preflop",
  flop: "flop",
  turn: "turn",
  river: "river",
  showdown: "showdown",
  complete: "settled",
};

function deriveGamePda(gameId: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [GAME_SEED, gameId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];
}

function deriveHandPda(gameId: BN, seatIndex: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [HAND_SEED, gameId.toArrayLike(Buffer, "le", 8), Buffer.from([seatIndex])],
    PROGRAM_ID
  )[0];
}

function getHandAccountsMap(gameId: BN) {
  return {
    hand0: deriveHandPda(gameId, 0),
    hand1: deriveHandPda(gameId, 1),
    hand2: deriveHandPda(gameId, 2),
    hand3: deriveHandPda(gameId, 3),
    hand4: deriveHandPda(gameId, 4),
    hand5: deriveHandPda(gameId, 5),
  };
}

function toBn(value: string): BN {
  if (/^\d+$/.test(value)) return new BN(value);
  const hex = Buffer.from(value.replace(/-/g, "").slice(0, 16), "hex");
  return new BN(hex, "be");
}

function getDelegationAccounts(pda: PublicKey, ownerProgram: PublicKey) {
  const permissionPda = permissionPdaFromAccount(pda);
  return {
    permission: permissionPda,
    permDelegationBuffer:
      delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
        permissionPda,
        new PublicKey(PERMISSION_PROGRAM_ID)
      ),
    permDelegationRecord:
      delegationRecordPdaFromDelegatedAccount(permissionPda),
    permDelegationMetadata:
      delegationMetadataPdaFromDelegatedAccount(permissionPda),
    bufferPlayerHand:
      delegateBufferPdaFromDelegatedAccountAndOwnerProgram(pda, ownerProgram),
    delegationRecordPlayerHand:
      delegationRecordPdaFromDelegatedAccount(pda),
    delegationMetadataPlayerHand:
      delegationMetadataPdaFromDelegatedAccount(pda),
  };
}

function getGameDelegationAccounts(gamePda: PublicKey) {
  const permissionPda = permissionPdaFromAccount(gamePda);
  return {
    permission: permissionPda,
    permDelegationBuffer:
      delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
        permissionPda,
        new PublicKey(PERMISSION_PROGRAM_ID)
      ),
    permDelegationRecord:
      delegationRecordPdaFromDelegatedAccount(permissionPda),
    permDelegationMetadata:
      delegationMetadataPdaFromDelegatedAccount(permissionPda),
    bufferGame:
      delegateBufferPdaFromDelegatedAccountAndOwnerProgram(gamePda, PROGRAM_ID),
    delegationRecordGame:
      delegationRecordPdaFromDelegatedAccount(gamePda),
    delegationMetadataGame:
      delegationMetadataPdaFromDelegatedAccount(gamePda),
  };
}

function parseGameAccount(account: any): GameStateSnapshot {
  const phaseKey = Object.keys(account.phase)[0] ?? "waiting";
  const phase = PHASE_VARIANT_MAP[phaseKey] ?? "unknown";

  const communityCards = Array.from(account.communityCards).slice(
    0,
    account.communityCount
  ) as number[];

  const players: PlayerSnapshot[] = [];
  for (let i = 0; i < account.playerCount; i++) {
    players.push({
      pubkey: account.players[i]!.toBase58(),
      displayName: `Player ${i}`,
      template: 0,
      seatIndex: i,
      status: STATUS_MAP[account.playerStatus[i]!] ?? "empty",
      currentBet: (account.playerBets[i] as BN).toNumber(),
    });
  }

  return {
    gameId: (account.gameId as BN).toString(),
    tableId: (account.tableId as BN).toString(),
    phase,
    pot: (account.pot as BN).toNumber(),
    currentBet: (account.currentBet as BN).toNumber(),
    currentPlayer: account.currentPlayer,
    communityCards,
    players,
    winnerIndex: account.winnerIndex,
  };
}

export class SolanaClient {
  private connection: Connection;
  private erConnection: Connection;
  private authority: Keypair;
  private program: Program;
  private erProgram: Program;
  private agentProgram: Program;

  constructor(
    rpcUrl: string,
    keypairPath: string,
    erEndpoint: string = "https://devnet.magicblock.app/",
    erWsEndpoint: string = "wss://devnet.magicblock.app/"
  ) {
    this.connection = new Connection(rpcUrl, "confirmed");
    const resolvedPath = keypairPath.replace("~", process.env.HOME ?? "");
    const keypairData = JSON.parse(
      readFileSync(resolve(resolvedPath), "utf-8")
    ) as number[];
    this.authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));

    const wallet = new Wallet(this.authority);
    const provider = new AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
    });
    this.program = new Program(gameIdl as any, provider);
    this.agentProgram = new Program(agentIdl as any, provider);

    this.erConnection = new Connection(erEndpoint, {
      wsEndpoint: erWsEndpoint,
      commitment: "confirmed",
    });
    const erProvider = new AnchorProvider(this.erConnection, wallet, {
      commitment: "confirmed",
    });
    this.erProgram = new Program(gameIdl as any, erProvider);
  }

  deriveGamePda(gameId: string): PublicKey {
    return deriveGamePda(toBn(gameId));
  }

  async createGame(
    gameId: string,
    tableId: string,
    wagerTier: number
  ): Promise<string> {
    const gameIdBn = toBn(gameId);
    const tableIdBn = toBn(tableId);
    const gamePda = deriveGamePda(gameIdBn);

    const tx = await (this.program.methods as any)
      .createGame(gameIdBn, tableIdBn, new BN(wagerTier))
      .accountsPartial({
        authority: this.authority.publicKey,
        game: gamePda,
        ...getHandAccountsMap(gameIdBn),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  async joinGame(
    gameId: string,
    seatIndex: number,
    playerPubkey: string
  ): Promise<string> {
    const gameIdBn = toBn(gameId);
    const gamePda = deriveGamePda(gameIdBn);
    const handPda = deriveHandPda(gameIdBn, seatIndex);
    const delegAccounts = getDelegationAccounts(handPda, PROGRAM_ID);
    const playerKey = new PublicKey(playerPubkey);

    const tx = await (this.program.methods as any)
      .joinGame(gameIdBn, seatIndex, playerKey)
      .accountsPartial({
        payer: this.authority.publicKey,
        game: gamePda,
        playerHand: handPda,
        permission: delegAccounts.permission,
        permDelegationBuffer: delegAccounts.permDelegationBuffer,
        permDelegationRecord: delegAccounts.permDelegationRecord,
        permDelegationMetadata: delegAccounts.permDelegationMetadata,
        validator: ER_VALIDATOR,
        permissionProgram: new PublicKey(PERMISSION_PROGRAM_ID),
        systemProgram: SystemProgram.programId,
        ownerProgram: PROGRAM_ID,
        delegationProgram: new PublicKey(DELEGATION_PROGRAM_ID),
        bufferPlayerHand: delegAccounts.bufferPlayerHand,
        delegationRecordPlayerHand: delegAccounts.delegationRecordPlayerHand,
        delegationMetadataPlayerHand: delegAccounts.delegationMetadataPlayerHand,
      })
      .rpc({ skipPreflight: true });

    return tx;
  }

  async delegateEmptyHands(
    gameId: string,
    filledSeats: number
  ): Promise<void> {
    const gameIdBn = toBn(gameId);

    for (let i = filledSeats; i < 6; i++) {
      const handPda = deriveHandPda(gameIdBn, i);
      await (this.program.methods as any)
        .delegatePda({ playerHand: { gameId: gameIdBn, seatIndex: i } })
        .accountsPartial({
          payer: this.authority.publicKey,
          pda: handPda,
          validator: ER_VALIDATOR,
        })
        .rpc({ skipPreflight: true });
    }
  }

  async startGame(gameId: string): Promise<string> {
    const gameIdBn = toBn(gameId);
    const gamePda = deriveGamePda(gameIdBn);
    const delegAccounts = getGameDelegationAccounts(gamePda);

    const tx = await (this.program.methods as any)
      .startGame(gameIdBn)
      .accountsPartial({
        payer: this.authority.publicKey,
        game: gamePda,
        permission: delegAccounts.permission,
        permDelegationBuffer: delegAccounts.permDelegationBuffer,
        permDelegationRecord: delegAccounts.permDelegationRecord,
        permDelegationMetadata: delegAccounts.permDelegationMetadata,
        validator: ER_VALIDATOR,
        permissionProgram: new PublicKey(PERMISSION_PROGRAM_ID),
        systemProgram: SystemProgram.programId,
        ownerProgram: PROGRAM_ID,
        delegationProgram: new PublicKey(DELEGATION_PROGRAM_ID),
        bufferGame: delegAccounts.bufferGame,
        delegationRecordGame: delegAccounts.delegationRecordGame,
        delegationMetadataGame: delegAccounts.delegationMetadataGame,
      })
      .rpc({ skipPreflight: true });

    return tx;
  }

  async waitForErAccount(
    pda: PublicKey,
    timeoutMs: number = 60_000
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const info = await this.erConnection.getAccountInfo(pda);
        if (info) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Account ${pda.toBase58()} not found on ER within ${timeoutMs}ms`);
  }

  async requestShuffle(gameId: string): Promise<string> {
    const gameIdBn = toBn(gameId);
    const gamePda = deriveGamePda(gameIdBn);

    const tx = await (this.erProgram.methods as any)
      .requestShuffle(0)
      .accountsPartial({
        payer: this.authority.publicKey,
        game: gamePda,
        authority: this.authority.publicKey,
        ...getHandAccountsMap(gameIdBn),
      })
      .rpc({ skipPreflight: true });

    return tx;
  }

  async pollForVrfCallback(
    gameId: string,
    timeoutMs: number = 120_000
  ): Promise<GameStateSnapshot> {
    const gameIdBn = toBn(gameId);
    const gamePda = deriveGamePda(gameIdBn);
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const account = await (this.erProgram.account as any).gameState.fetch(gamePda);
        const phase = JSON.stringify(account.phase);
        if (phase !== JSON.stringify({ waiting: {} })) {
          return parseGameAccount(account);
        }
      } catch {}
    }
    throw new Error(`VRF callback did not complete within ${timeoutMs}ms`);
  }

  async playerAction(
    gameId: string,
    action: number,
    raiseAmount: number
  ): Promise<string> {
    const gameIdBn = toBn(gameId);
    const gamePda = deriveGamePda(gameIdBn);

    const tx = await (this.erProgram.methods as any)
      .playerAction(action, new BN(raiseAmount))
      .accountsPartial({
        authority: this.authority.publicKey,
        game: gamePda,
      })
      .rpc({ skipPreflight: true });

    return tx;
  }

  async showdownTest(gameId: string): Promise<string> {
    const gameIdBn = toBn(gameId);
    const gamePda = deriveGamePda(gameIdBn);

    const tx = await (this.erProgram.methods as any)
      .showdownTest()
      .accountsPartial({
        authority: this.authority.publicKey,
        game: gamePda,
        ...getHandAccountsMap(gameIdBn),
      })
      .rpc({ skipPreflight: true });

    return tx;
  }

  async commitGame(gameId: string): Promise<string> {
    const gameIdBn = toBn(gameId);
    const gamePda = deriveGamePda(gameIdBn);

    const tx = await (this.erProgram.methods as any)
      .commitGame()
      .accountsPartial({
        payer: this.authority.publicKey,
        game: gamePda,
      })
      .rpc({ skipPreflight: true });

    return tx;
  }

  async getGameState(
    gameId: string,
    fromEr: boolean = false
  ): Promise<GameStateSnapshot | null> {
    try {
      const gameIdBn = toBn(gameId);
      const gamePda = deriveGamePda(gameIdBn);
      const program = fromEr ? this.erProgram : this.program;
      const account = await (program.account as any).gameState.fetch(gamePda);
      return parseGameAccount(account);
    } catch {
      return null;
    }
  }

  async getPlayerHand(
    gameId: string,
    seatIndex: number,
    fromEr: boolean = false
  ): Promise<{ hand: number[] } | null> {
    try {
      const gameIdBn = toBn(gameId);
      const handPda = deriveHandPda(gameIdBn, seatIndex);
      const program = fromEr ? this.erProgram : this.program;
      const account = await (program.account as any).playerHand.fetch(handPda);
      return { hand: Array.from(account.hand) };
    } catch {
      return null;
    }
  }

  async waitForBaseLayerSettle(
    gameId: string,
    timeoutMs: number = 120_000
  ): Promise<GameStateSnapshot | null> {
    const gameIdBn = toBn(gameId);
    const gamePda = deriveGamePda(gameIdBn);
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const account = await (this.program.account as any).gameState.fetch(gamePda);
        const phase = JSON.stringify(account.phase);
        if (phase === JSON.stringify({ complete: {} })) {
          return parseGameAccount(account);
        }
      } catch {}
    }
    return null;
  }

  deriveAgentPda(ownerPubkey: string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [AGENT_SEED, new PublicKey(ownerPubkey).toBuffer()],
      AGENT_PROGRAM_ID
    )[0];
  }

  async updateAgentStats(
    ownerPubkey: string,
    gamesDelta: number,
    winsDelta: number,
    earningsDelta: number
  ): Promise<string> {
    const agentPda = this.deriveAgentPda(ownerPubkey);

    const tx = await (this.agentProgram.methods as any)
      .updateStats(
        new BN(gamesDelta),
        new BN(winsDelta),
        new BN(earningsDelta)
      )
      .accountsPartial({
        authority: this.authority.publicKey,
        agent: agentPda,
      })
      .rpc();

    return tx;
  }
}
