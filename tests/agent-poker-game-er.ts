import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";
import { AgentPokerGame } from "../target/types/agent_poker_game";
import { fundKeypair } from "./helpers";
import {
  DEFAULT_VALIDATOR,
  DELEGATION_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  permissionPdaFromAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const ER_ENDPOINT =
  process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
  "https://devnet.magicblock.app/";
const ER_WS_ENDPOINT =
  process.env.EPHEMERAL_WS_ENDPOINT ||
  "wss://devnet.magicblock.app/";

describe("agent_poker_game_er", () => {
  const baseProvider = new anchor.AnchorProvider(
    anchor.AnchorProvider.env().connection,
    anchor.AnchorProvider.env().wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(baseProvider);
  const baseProgram = anchor.workspace
    .agentPokerGame as Program<AgentPokerGame>;

  const ER_VALIDATOR = new PublicKey(DEFAULT_VALIDATOR);

  const authority = Keypair.generate();
  const playerKeys = Array.from(
    { length: 2 },
    () => Keypair.generate().publicKey
  );
  const WAGER = new BN(0.01 * LAMPORTS_PER_SOL);

  let gameId: BN;
  let gamePda: PublicKey;
  let erProvider: anchor.AnchorProvider;
  let erProgram: Program;

  function deriveGamePda(id: BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("poker_game"), id.toArrayLike(Buffer, "le", 8)],
      baseProgram.programId
    );
  }

  function deriveHandPda(
    id: BN,
    seatIndex: number
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_hand"),
        id.toArrayLike(Buffer, "le", 8),
        Buffer.from([seatIndex]),
      ],
      baseProgram.programId
    );
  }

  function getHandMetas(
    id: BN,
    count: number
  ): anchor.web3.AccountMeta[] {
    return Array.from({ length: count }, (_, i) => ({
      pubkey: deriveHandPda(id, i)[0],
      isSigner: false,
      isWritable: true,
    }));
  }

  function getPermissionDelegationAccounts(pda: PublicKey) {
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
    };
  }

  before(async () => {
    await fundKeypair(baseProvider, authority, 0.5 * LAMPORTS_PER_SOL);

    gameId = new BN(Date.now());
    [gamePda] = deriveGamePda(gameId);

    erProvider = new anchor.AnchorProvider(
      new anchor.web3.Connection(ER_ENDPOINT, {
        wsEndpoint: ER_WS_ENDPOINT,
      }),
      new anchor.Wallet(authority),
      { commitment: "confirmed" }
    );
    erProgram = new Program(baseProgram.idl as any, erProvider);

    console.log("Base layer:", baseProvider.connection.rpcEndpoint);
    console.log("ER endpoint:", ER_ENDPOINT);
    console.log("ER validator:", ER_VALIDATOR.toBase58());
    console.log("Game PDA:", gamePda.toBase58());
    console.log("Authority:", authority.publicKey.toBase58());
  });

  it("creates game on base layer (with permission for GameState)", async () => {
    const permAccounts = getPermissionDelegationAccounts(gamePda);

    await baseProgram.methods
      .createGame(gameId, new BN(1), WAGER)
      .accountsPartial({
        authority: authority.publicKey,
        game: gamePda,
        permission: permAccounts.permission,
        permDelegationBuffer: permAccounts.permDelegationBuffer,
        permDelegationRecord: permAccounts.permDelegationRecord,
        permDelegationMetadata: permAccounts.permDelegationMetadata,
        validator: ER_VALIDATOR,
        permissionProgram: new PublicKey(PERMISSION_PROGRAM_ID),
        delegationProgram: new PublicKey(DELEGATION_PROGRAM_ID),
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc({ skipPreflight: true });

    const game = await baseProgram.account.gameState.fetch(gamePda);
    expect(game.playerCount).to.equal(0);
    expect(JSON.stringify(game.phase)).to.equal(
      JSON.stringify({ waiting: {} })
    );
    console.log("Game created (permission set up for GameState)");
  });

  it("players join game (init hand + delegate)", async () => {
    for (let i = 0; i < playerKeys.length; i++) {
      const handPda = deriveHandPda(gameId, i)[0];
      const handPermAccounts =
        getPermissionDelegationAccounts(handPda);

      await baseProgram.methods
        .joinGame(gameId, i, playerKeys[i])
        .accountsPartial({
          payer: authority.publicKey,
          game: gamePda,
          playerHand: handPda,
          handPermission: handPermAccounts.permission,
          permDelegationBuffer:
            handPermAccounts.permDelegationBuffer,
          permDelegationRecord:
            handPermAccounts.permDelegationRecord,
          permDelegationMetadata:
            handPermAccounts.permDelegationMetadata,
          validator: ER_VALIDATOR,
          permissionProgram: new PublicKey(PERMISSION_PROGRAM_ID),
          delegationProgram: new PublicKey(DELEGATION_PROGRAM_ID),
          systemProgram: SystemProgram.programId,
          bufferPlayerHand:
            delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
              handPda,
              baseProgram.programId
            ),
          delegationRecordPlayerHand:
            delegationRecordPdaFromDelegatedAccount(handPda),
          delegationMetadataPlayerHand:
            delegationMetadataPdaFromDelegatedAccount(handPda),
          ownerProgram: baseProgram.programId,
        })
        .signers([authority])
        .rpc({ skipPreflight: true });

      console.log(`Player ${i} joined (hand created + delegated)`);
    }

    const game = await baseProgram.account.gameState.fetch(gamePda);
    expect(game.playerCount).to.equal(playerKeys.length);
    console.log(`${playerKeys.length} players joined`);
  });

  it("starts game (delegates GameState to ER)", async () => {
    await baseProgram.methods
      .startGame(gameId)
      .accountsPartial({
        payer: authority.publicKey,
        game: gamePda,
        bufferGame:
          delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
            gamePda,
            baseProgram.programId
          ),
        delegationRecordGame:
          delegationRecordPdaFromDelegatedAccount(gamePda),
        delegationMetadataGame:
          delegationMetadataPdaFromDelegatedAccount(gamePda),
        validator: ER_VALIDATOR,
        systemProgram: SystemProgram.programId,
        ownerProgram: baseProgram.programId,
        delegationProgram: new PublicKey(DELEGATION_PROGRAM_ID),
      })
      .signers([authority])
      .rpc({ skipPreflight: true });

    console.log("Game delegated to ER");

    console.log("Waiting for accounts on ER...");
    for (let i = 0; i < 30; i++) {
      try {
        const info =
          await erProvider.connection.getAccountInfo(gamePda);
        if (info) {
          console.log("Game account available on ER");
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }
  });

  it("requests VRF shuffle and waits for callback", async () => {
    await (erProgram.methods as any)
      .requestShuffle(0)
      .accountsPartial({
        payer: authority.publicKey,
        game: gamePda,
        authority: authority.publicKey,
      })
      .remainingAccounts(getHandMetas(gameId, playerKeys.length))
      .rpc({ skipPreflight: true });
    console.log("VRF shuffle requested");

    console.log("Waiting for VRF callback...");
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const game = await (erProgram.account as any).gameState.fetch(
          gamePda
        );
        const phase = JSON.stringify(game.phase);
        if (phase !== JSON.stringify({ waiting: {} })) {
          console.log("VRF callback completed, phase:", phase);
          expect(phase).to.equal(JSON.stringify({ preflop: {} }));

          const hand0 = await (
            erProgram.account as any
          ).playerHand.fetch(deriveHandPda(gameId, 0)[0]);
          expect(hand0.hand[0]).to.not.equal(255);
          expect(hand0.hand[1]).to.not.equal(255);
          console.log(
            "Player 0 dealt:",
            hand0.hand[0],
            hand0.hand[1]
          );

          expect(game.pot.toNumber()).to.be.greaterThan(0);
          console.log("Pot after blinds:", game.pot.toNumber());
          return;
        }
      } catch {}
    }
    throw new Error(
      "VRF callback did not complete within 120 seconds"
    );
  });

  it("executes player fold on ER to trigger showdown", async () => {
    const game = await (erProgram.account as any).gameState.fetch(
      gamePda
    );
    const currentPlayer = game.currentPlayer;
    console.log(`Current player index: ${currentPlayer}`);

    await (erProgram.methods as any)
      .playerAction(0, new BN(0))
      .accountsPartial({
        authority: authority.publicKey,
        game: gamePda,
      })
      .rpc({ skipPreflight: true });

    const gameAfter = await (erProgram.account as any).gameState.fetch(
      gamePda
    );
    expect(JSON.stringify(gameAfter.phase)).to.equal(
      JSON.stringify({ showdown: {} })
    );
    console.log("Player folded, phase: showdown");
  });

  it("runs showdown_test on ER to determine winner", async () => {
    await (erProgram.methods as any)
      .showdownTest()
      .accountsPartial({
        authority: authority.publicKey,
        game: gamePda,
      })
      .remainingAccounts(getHandMetas(gameId, playerKeys.length))
      .rpc({ skipPreflight: true });

    const game = await (erProgram.account as any).gameState.fetch(
      gamePda
    );
    expect(JSON.stringify(game.phase)).to.equal(
      JSON.stringify({ complete: {} })
    );
    expect(game.winnerIndex).to.be.lessThan(2);
    console.log(
      `Winner: player ${game.winnerIndex} (${game.players[game.winnerIndex].toBase58()})`
    );
    console.log(`Final pot: ${game.pot.toNumber()}`);
  });

  it("commits game state back to base layer", async () => {
    const txSig = await (erProgram.methods as any)
      .commitGame()
      .accountsPartial({
        payer: authority.publicKey,
        game: gamePda,
      })
      .rpc({ skipPreflight: true });
    console.log("Commit tx:", txSig);

    console.log("Waiting for commit to settle on base layer...");
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const game =
          await baseProgram.account.gameState.fetch(gamePda);
        if (
          JSON.stringify(game.phase) ===
          JSON.stringify({ complete: {} })
        ) {
          console.log("Game state verified on base layer!");
          expect(game.winnerIndex).to.be.lessThan(2);
          expect(game.pot.toNumber()).to.be.greaterThan(0);
          console.log(
            `Base layer: winner=${game.winnerIndex}, pot=${game.pot.toNumber()}`
          );
          return;
        }
      } catch {}
    }
    throw new Error(
      "Game state did not settle on base layer within 120s"
    );
  });
});
