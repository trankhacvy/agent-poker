import fp from "fastify-plugin";
import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
// @ts-ignore -- bn.js lacks type declarations in this setup
import BN from "bn.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import bs58 from "bs58";
import type { GameStateSnapshot, PlayerSnapshot } from "../types.js";
import gameIdl from "../../idl/agent_poker_game.json";
import agentIdl from "../../idl/agent_poker_agent.json";
import bettingIdl from "../../idl/agent_poker_betting.json";
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
const BETTING_PROGRAM_ID = new PublicKey(bettingIdl.address);
const ER_VALIDATOR = new PublicKey(DEFAULT_VALIDATOR);

const GAME_SEED = Buffer.from("poker_game");
const HAND_SEED = Buffer.from("player_hand");
const AGENT_SEED = Buffer.from("agent");
const POOL_SEED = Buffer.from("bet_pool");
const POOL_VAULT_SEED = Buffer.from("pool_vault");
const BET_SEED = Buffer.from("bet");
const TREASURY_SEED = Buffer.from("treasury");

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

function deriveGamePdaInternal(gameId: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [GAME_SEED, gameId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];
}

function deriveHandPda(gameId: BN, seatIndex: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      HAND_SEED,
      gameId.toArrayLike(Buffer, "le", 8),
      Buffer.from([seatIndex]),
    ],
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

/**
 * Convert a game/table ID string to a BN for on-chain use.
 *
 * Accepts two formats:
 * 1. Pure numeric string (e.g. "1234567890") — used directly as BN.
 * 2. UUID-like string (e.g. "550e8400-e29b-41d4-...") — dashes are stripped,
 *    the first 16 hex chars are taken and converted to a big-endian BN.
 *    This truncates to u64 (8 bytes), which is sufficient for on-chain PDA seeds.
 */
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
      delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
        pda,
        ownerProgram
      ),
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
      delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
        gamePda,
        PROGRAM_ID
      ),
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
  private bettingProgram: Program;
  private log: FastifyBaseLogger;

  private static loadKeypair(pathOrBase58: string): Keypair {
    const looksLikePath =
      pathOrBase58.includes("/") ||
      pathOrBase58.includes("\\") ||
      pathOrBase58.startsWith("~");
    if (looksLikePath) {
      const resolvedPath = pathOrBase58.replace(
        "~",
        process.env.HOME ?? ""
      );
      const fullPath = resolve(resolvedPath);
      if (!existsSync(fullPath)) {
        throw new Error(
          `Keypair file not found: ${fullPath}. Set AUTHORITY_PRIVATE_KEY (base58) for deployments without filesystem access.`
        );
      }
      const keypairData = JSON.parse(
        readFileSync(fullPath, "utf-8")
      ) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    }
    return Keypair.fromSecretKey(bs58.decode(pathOrBase58));
  }

  constructor(
    rpcUrl: string,
    keypairPathOrBase58: string,
    erEndpoint: string,
    erWsEndpoint: string,
    log: FastifyBaseLogger
  ) {
    this.log = log;
    this.connection = new Connection(rpcUrl, "confirmed");
    this.authority = SolanaClient.loadKeypair(keypairPathOrBase58);

    const wallet = new Wallet(this.authority);
    const provider = new AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
    });
    this.program = new Program(gameIdl as any, provider);
    this.agentProgram = new Program(agentIdl as any, provider);
    this.bettingProgram = new Program(bettingIdl as any, provider);

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
    return deriveGamePdaInternal(toBn(gameId));
  }

  async createGame(
    gameId: string,
    tableId: string,
    wagerTier: number
  ): Promise<string> {
    const gameIdBn = toBn(gameId);
    const tableIdBn = toBn(tableId);
    const gamePda = deriveGamePdaInternal(gameIdBn);

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
    const gamePda = deriveGamePdaInternal(gameIdBn);
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
        delegationRecordPlayerHand:
          delegAccounts.delegationRecordPlayerHand,
        delegationMetadataPlayerHand:
          delegAccounts.delegationMetadataPlayerHand,
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
        .delegatePda({
          playerHand: { gameId: gameIdBn, seatIndex: i },
        })
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
    const gamePda = deriveGamePdaInternal(gameIdBn);
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
      } catch (err) {
        this.log.debug({ err }, "ER account poll error");
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(
      `Account ${pda.toBase58()} not found on ER within ${timeoutMs}ms`
    );
  }

  async requestShuffle(gameId: string): Promise<string> {
    const gameIdBn = toBn(gameId);
    const gamePda = deriveGamePdaInternal(gameIdBn);

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
    const gamePda = deriveGamePdaInternal(gameIdBn);
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const account = await (
          this.erProgram.account as any
        ).gameState.fetch(gamePda);
        const phase = JSON.stringify(account.phase);
        if (phase !== JSON.stringify({ waiting: {} })) {
          return parseGameAccount(account);
        }
      } catch (err) {
        this.log.debug({ err }, "VRF poll error");
      }
    }
    throw new Error(
      `VRF callback did not complete within ${timeoutMs}ms`
    );
  }

  async playerAction(
    gameId: string,
    action: number,
    raiseAmount: number
  ): Promise<string> {
    const gameIdBn = toBn(gameId);
    const gamePda = deriveGamePdaInternal(gameIdBn);

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
    const gamePda = deriveGamePdaInternal(gameIdBn);

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
    const gamePda = deriveGamePdaInternal(gameIdBn);

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
      const gamePda = deriveGamePdaInternal(gameIdBn);
      const program = fromEr ? this.erProgram : this.program;
      const account = await (
        program.account as any
      ).gameState.fetch(gamePda);
      return parseGameAccount(account);
    } catch (err) {
      this.log.debug({ err }, "Failed to fetch game state");
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
      const account = await (
        program.account as any
      ).playerHand.fetch(handPda);
      return { hand: Array.from(account.hand) };
    } catch (err) {
      this.log.debug({ err }, "Failed to fetch player hand");
      return null;
    }
  }

  async waitForBaseLayerSettle(
    gameId: string,
    timeoutMs: number = 120_000
  ): Promise<GameStateSnapshot | null> {
    const gameIdBn = toBn(gameId);
    const gamePda = deriveGamePdaInternal(gameIdBn);
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const account = await (
          this.program.account as any
        ).gameState.fetch(gamePda);
        const phase = JSON.stringify(account.phase);
        if (phase === JSON.stringify({ complete: {} })) {
          return parseGameAccount(account);
        }
      } catch (err) {
        this.log.debug({ err }, "Base layer settle poll error");
      }
    }
    return null;
  }

  async confirmTransaction(signature: string): Promise<boolean> {
    try {
      const result = await this.connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });
      const status = result?.value;
      if (!status) return false;
      return (
        status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized"
      );
    } catch {
      return false;
    }
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

  // ── Betting Pool Methods ──────────────────────────────────

  private deriveBettingPoolPda(tableId: string): PublicKey {
    const tableIdBn = toBn(tableId);
    return PublicKey.findProgramAddressSync(
      [POOL_SEED, tableIdBn.toArrayLike(Buffer, "le", 8)],
      BETTING_PROGRAM_ID
    )[0];
  }

  private deriveBettingPoolVaultPda(poolPda: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [POOL_VAULT_SEED, poolPda.toBuffer()],
      BETTING_PROGRAM_ID
    )[0];
  }

  private deriveBetPda(poolPda: PublicKey, bettor: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [BET_SEED, poolPda.toBuffer(), bettor.toBuffer()],
      BETTING_PROGRAM_ID
    )[0];
  }

  private deriveTreasuryPda(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [TREASURY_SEED],
      BETTING_PROGRAM_ID
    )[0];
  }

  async createBettingPool(
    tableId: string,
    agentPubkeys: string[]
  ): Promise<void> {
    const tableIdBn = toBn(tableId);
    const poolPda = this.deriveBettingPoolPda(tableId);
    const poolVault = this.deriveBettingPoolVaultPda(poolPda);
    const agents = agentPubkeys.map((pk) => new PublicKey(pk));

    // Pad to 6 agents if needed
    while (agents.length < 6) {
      agents.push(SystemProgram.programId);
    }

    await (this.bettingProgram.methods as any)
      .createPool(tableIdBn, agents)
      .accountsPartial({
        authority: this.authority.publicKey,
        pool: poolPda,
        poolVault,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async lockBettingPool(tableId: string): Promise<void> {
    const poolPda = this.deriveBettingPoolPda(tableId);

    await (this.bettingProgram.methods as any)
      .lockPool()
      .accountsPartial({
        authority: this.authority.publicKey,
        pool: poolPda,
      })
      .rpc();
  }

  async settleBettingPool(
    tableId: string,
    winnerIndex: number
  ): Promise<void> {
    const poolPda = this.deriveBettingPoolPda(tableId);
    const poolVault = this.deriveBettingPoolVaultPda(poolPda);
    const treasury = this.deriveTreasuryPda();

    await (this.bettingProgram.methods as any)
      .settlePool(winnerIndex)
      .accountsPartial({
        authority: this.authority.publicKey,
        pool: poolPda,
        poolVault,
        treasury,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async cancelBettingPool(tableId: string): Promise<void> {
    const poolPda = this.deriveBettingPoolPda(tableId);

    await (this.bettingProgram.methods as any)
      .cancelPool()
      .accountsPartial({
        authority: this.authority.publicKey,
        pool: poolPda,
      })
      .rpc();
  }

  async refundBet(tableId: string, bettorWallet: string): Promise<void> {
    const poolPda = this.deriveBettingPoolPda(tableId);
    const poolVault = this.deriveBettingPoolVaultPda(poolPda);
    const bettorPubkey = new PublicKey(bettorWallet);
    const betPda = this.deriveBetPda(poolPda, bettorPubkey);

    await (this.bettingProgram.methods as any)
      .refundBet()
      .accountsPartial({
        bettor: bettorPubkey,
        pool: poolPda,
        poolVault,
        bet: betPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async closeBettingPool(tableId: string): Promise<void> {
    const poolPda = this.deriveBettingPoolPda(tableId);
    const poolVault = this.deriveBettingPoolVaultPda(poolPda);

    await (this.bettingProgram.methods as any)
      .closePool()
      .accountsPartial({
        authority: this.authority.publicKey,
        pool: poolPda,
        poolVault,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }
}

declare module "fastify" {
  interface FastifyInstance {
    solanaWrite: SolanaClient;
  }
}

export default fp(
  async (fastify: FastifyInstance) => {
    const keypathOrKey =
      fastify.env.AUTHORITY_PRIVATE_KEY ??
      fastify.env.AUTHORITY_KEYPAIR_PATH ??
      "~/.config/solana/id.json";

    const client = new SolanaClient(
      fastify.env.SOLANA_RPC_URL,
      keypathOrKey,
      fastify.env.EPHEMERAL_PROVIDER_ENDPOINT,
      fastify.env.EPHEMERAL_WS_ENDPOINT,
      fastify.log
    );
    fastify.decorate("solanaWrite", client);
    fastify.log.info("Solana write plugin loaded");
  },
  { name: "solana-write", dependencies: ["env"] }
);
