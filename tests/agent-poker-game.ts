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

function generateShuffledDeck(): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

describe("agent_poker_game", () => {
  const provider = new anchor.AnchorProvider(
    anchor.AnchorProvider.env().connection,
    anchor.AnchorProvider.env().wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace
    .agentPokerGame as Program<AgentPokerGame>;

  const authority = Keypair.generate();
  const playerKeys = Array.from(
    { length: 6 },
    () => Keypair.generate().publicKey
  );
  const WAGER = new BN(0.01 * LAMPORTS_PER_SOL);

  let gameId: BN;
  let gamePda: PublicKey;

  function deriveGamePda(id: BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("poker_game"), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  }

  function deriveHandPda(id: BN, seatIndex: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("player_hand"),
        id.toArrayLike(Buffer, "le", 8),
        Buffer.from([seatIndex]),
      ],
      program.programId
    );
  }

  function getHandAccounts(id: BN) {
    return {
      hand0: deriveHandPda(id, 0)[0],
      hand1: deriveHandPda(id, 1)[0],
      hand2: deriveHandPda(id, 2)[0],
      hand3: deriveHandPda(id, 3)[0],
      hand4: deriveHandPda(id, 4)[0],
      hand5: deriveHandPda(id, 5)[0],
    };
  }

  before(async () => {
    await fundKeypair(provider, authority);

    gameId = new BN(Date.now());
    [gamePda] = deriveGamePda(gameId);
  });

  describe("create_game", () => {
    it("creates a game with valid players", async () => {
      const tableId = new BN(1);

      await program.methods
        .createGameTest(gameId, tableId, playerKeys, WAGER)
        .accountsPartial({
          authority: authority.publicKey,
          game: gamePda,
          ...getHandAccounts(gameId),
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const game = await program.account.gameState.fetch(gamePda);
      expect(game.gameId.toString()).to.equal(gameId.toString());
      expect(game.tableId.toString()).to.equal(tableId.toString());
      expect(game.playerCount).to.equal(6);
      expect(game.wagerTier.toString()).to.equal(WAGER.toString());
      expect(JSON.stringify(game.phase)).to.equal(
        JSON.stringify({ waiting: {} })
      );
      expect(game.pot.toNumber()).to.equal(0);
      expect(game.authority.toBase58()).to.equal(
        authority.publicKey.toBase58()
      );

      for (let i = 0; i < 6; i++) {
        expect(game.players[i].toBase58()).to.equal(
          playerKeys[i].toBase58()
        );
        expect(game.playerStatus[i]).to.equal(1); // Active
      }

      // Verify PlayerHand PDAs are initialized
      const hand0 = await program.account.playerHand.fetch(
        deriveHandPda(gameId, 0)[0]
      );
      expect(hand0.gameId.toString()).to.equal(gameId.toString());
      expect(hand0.player.toBase58()).to.equal(playerKeys[0].toBase58());
      expect(hand0.hand[0]).to.equal(255);
      expect(hand0.hand[1]).to.equal(255);
    });

    it("rejects fewer than 2 players", async () => {
      const badGameId = new BN(Date.now() + 100);
      const [badGamePda] = deriveGamePda(badGameId);

      try {
        await program.methods
          .createGameTest(badGameId, new BN(1), [playerKeys[0]], WAGER)
          .accountsPartial({
            authority: authority.publicKey,
            game: badGamePda,
            ...getHandAccounts(badGameId),
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as anchor.AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("InvalidPlayerCount");
      }
    });
  });

  describe("deal_cards", () => {
    it("deals with valid shuffled deck", async () => {
      const deck = generateShuffledDeck();

      await program.methods
        .dealCards(Buffer.from(deck))
        .accountsPartial({
          authority: authority.publicKey,
          game: gamePda,
          ...getHandAccounts(gameId),
        })
        .signers([authority])
        .rpc();

      const game = await program.account.gameState.fetch(gamePda);
      expect(JSON.stringify(game.phase)).to.equal(
        JSON.stringify({ preflop: {} })
      );

      // Verify hands are dealt to PlayerHand PDAs
      const hand0 = await program.account.playerHand.fetch(
        deriveHandPda(gameId, 0)[0]
      );
      expect(hand0.hand[0]).to.equal(deck[0]);
      expect(hand0.hand[1]).to.equal(deck[1]);

      const hand1 = await program.account.playerHand.fetch(
        deriveHandPda(gameId, 1)[0]
      );
      expect(hand1.hand[0]).to.equal(deck[2]);
      expect(hand1.hand[1]).to.equal(deck[3]);

      // Verify community cards
      for (let j = 0; j < 5; j++) {
        expect(game.communityCards[j]).to.equal(deck[12 + j]);
      }

      // Verify blinds
      const smallBlind = Math.floor((WAGER.toNumber() * 50) / 1000);
      const bigBlind = Math.floor((WAGER.toNumber() * 100) / 1000);
      expect(game.pot.toNumber()).to.equal(smallBlind + bigBlind);
      expect(game.currentBet.toNumber()).to.equal(bigBlind);
    });
  });

  describe("player_action", () => {
    let actionGameId: BN;
    let actionGamePda: PublicKey;

    before(async () => {
      actionGameId = new BN(Date.now() + 200);
      [actionGamePda] = deriveGamePda(actionGameId);

      const twoPlayers = playerKeys.slice(0, 2);

      await program.methods
        .createGameTest(actionGameId, new BN(2), twoPlayers, WAGER)
        .accountsPartial({
          authority: authority.publicKey,
          game: actionGamePda,
          ...getHandAccounts(actionGameId),
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const deck = generateShuffledDeck();
      await program.methods
        .dealCards(Buffer.from(deck))
        .accountsPartial({
          authority: authority.publicKey,
          game: actionGamePda,
          ...getHandAccounts(actionGameId),
        })
        .signers([authority])
        .rpc();
    });

    it("fold sets player to folded", async () => {
      const gameBefore = await program.account.gameState.fetch(actionGamePda);
      const currentIdx = gameBefore.currentPlayer;

      await program.methods
        .playerAction(0, new BN(0))
        .accountsPartial({
          authority: authority.publicKey,
          game: actionGamePda,
        })
        .signers([authority])
        .rpc();

      const gameAfter = await program.account.gameState.fetch(actionGamePda);
      expect(gameAfter.playerStatus[currentIdx]).to.equal(2); // Folded
    });
  });

  describe("player_action (check, call, raise)", () => {
    let checkGameId: BN;
    let checkGamePda: PublicKey;

    before(async () => {
      checkGameId = new BN(Date.now() + 300);
      [checkGamePda] = deriveGamePda(checkGameId);

      const threePlayers = playerKeys.slice(0, 3);

      await program.methods
        .createGameTest(checkGameId, new BN(3), threePlayers, WAGER)
        .accountsPartial({
          authority: authority.publicKey,
          game: checkGamePda,
          ...getHandAccounts(checkGameId),
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const deck = generateShuffledDeck();
      await program.methods
        .dealCards(Buffer.from(deck))
        .accountsPartial({
          authority: authority.publicKey,
          game: checkGamePda,
          ...getHandAccounts(checkGameId),
        })
        .signers([authority])
        .rpc();
    });

    it("call matches the current bet", async () => {
      const gameBefore = await program.account.gameState.fetch(checkGamePda);
      const potBefore = gameBefore.pot.toNumber();

      await program.methods
        .playerAction(2, new BN(0)) // Call
        .accountsPartial({
          authority: authority.publicKey,
          game: checkGamePda,
        })
        .signers([authority])
        .rpc();

      const gameAfter = await program.account.gameState.fetch(checkGamePda);
      expect(gameAfter.pot.toNumber()).to.be.greaterThan(potBefore);
    });

    it("raise increases the current bet", async () => {
      const gameBefore = await program.account.gameState.fetch(checkGamePda);
      const currentBetBefore = gameBefore.currentBet.toNumber();
      const raiseAmount = currentBetBefore * 2;

      await program.methods
        .playerAction(3, new BN(raiseAmount)) // Raise
        .accountsPartial({
          authority: authority.publicKey,
          game: checkGamePda,
        })
        .signers([authority])
        .rpc();

      const gameAfter = await program.account.gameState.fetch(checkGamePda);
      expect(gameAfter.currentBet.toNumber()).to.equal(raiseAmount);
    });

    it("check succeeds when no outstanding bet", async () => {
      const checkGameId2 = new BN(Date.now() + 400);
      const [checkGamePda2] = deriveGamePda(checkGameId2);

      const twoPlayers = playerKeys.slice(0, 2);

      await program.methods
        .createGameTest(checkGameId2, new BN(4), twoPlayers, WAGER)
        .accountsPartial({
          authority: authority.publicKey,
          game: checkGamePda2,
          ...getHandAccounts(checkGameId2),
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const deck = generateShuffledDeck();
      await program.methods
        .dealCards(Buffer.from(deck))
        .accountsPartial({
          authority: authority.publicKey,
          game: checkGamePda2,
          ...getHandAccounts(checkGameId2),
        })
        .signers([authority])
        .rpc();

      const game = await program.account.gameState.fetch(checkGamePda2);
      const currentPlayerIdx = game.currentPlayer;
      const playerBet = game.playerBets[currentPlayerIdx].toNumber();
      const currentBet = game.currentBet.toNumber();

      if (playerBet === currentBet) {
        await program.methods
          .playerAction(1, new BN(0)) // Check
          .accountsPartial({
            authority: authority.publicKey,
            game: checkGamePda2,
          })
          .signers([authority])
          .rpc();

        const updated = await program.account.gameState.fetch(checkGamePda2);
        expect(updated.currentPlayer).to.not.equal(currentPlayerIdx);
      } else {
        // If current player owes, call instead
        await program.methods
          .playerAction(2, new BN(0)) // Call
          .accountsPartial({
            authority: authority.publicKey,
            game: checkGamePda2,
          })
          .signers([authority])
          .rpc();

        const updated = await program.account.gameState.fetch(checkGamePda2);
        expect(updated.pot.toNumber()).to.be.greaterThan(game.pot.toNumber());
      }
    });
  });

  describe("phase advancement", () => {
    it("advances from preflop through flop, turn, river", async () => {
      const phaseGameId = new BN(Date.now() + 500);
      const [phaseGamePda] = deriveGamePda(phaseGameId);

      const twoPlayers = playerKeys.slice(0, 2);

      await program.methods
        .createGameTest(phaseGameId, new BN(5), twoPlayers, WAGER)
        .accountsPartial({
          authority: authority.publicKey,
          game: phaseGamePda,
          ...getHandAccounts(phaseGameId),
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const deck = generateShuffledDeck();
      await program.methods
        .dealCards(Buffer.from(deck))
        .accountsPartial({
          authority: authority.publicKey,
          game: phaseGamePda,
          ...getHandAccounts(phaseGameId),
        })
        .signers([authority])
        .rpc();

      let game = await program.account.gameState.fetch(phaseGamePda);
      expect(JSON.stringify(game.phase)).to.equal(
        JSON.stringify({ preflop: {} })
      );

      const advancePhase = async () => {
        game = await program.account.gameState.fetch(phaseGamePda);
        const currentPhase = JSON.stringify(game.phase);

        for (let i = 0; i < 10; i++) {
          game = await program.account.gameState.fetch(phaseGamePda);
          const phase = JSON.stringify(game.phase);
          if (phase !== currentPhase) break;

          const playerIdx = game.currentPlayer;
          if (game.playerStatus[playerIdx] !== 1) break;

          if (
            game.playerBets[playerIdx].toNumber() ===
            game.currentBet.toNumber()
          ) {
            await program.methods
              .playerAction(1, new BN(0)) // Check
              .accountsPartial({
                authority: authority.publicKey,
                game: phaseGamePda,
              })
              .signers([authority])
              .rpc();
          } else {
            await program.methods
              .playerAction(2, new BN(0)) // Call
              .accountsPartial({
                authority: authority.publicKey,
                game: phaseGamePda,
              })
              .signers([authority])
              .rpc();
          }
        }
      };

      await advancePhase();
      game = await program.account.gameState.fetch(phaseGamePda);
      expect(JSON.stringify(game.phase)).to.equal(
        JSON.stringify({ flop: {} })
      );
      expect(game.communityCount).to.equal(3);

      await advancePhase();
      game = await program.account.gameState.fetch(phaseGamePda);
      expect(JSON.stringify(game.phase)).to.equal(
        JSON.stringify({ turn: {} })
      );
      expect(game.communityCount).to.equal(4);

      await advancePhase();
      game = await program.account.gameState.fetch(phaseGamePda);
      expect(JSON.stringify(game.phase)).to.equal(
        JSON.stringify({ river: {} })
      );
      expect(game.communityCount).to.equal(5);
    });
  });

  describe("showdown", () => {
    it("picks a winner", async () => {
      const showdownGameId = new BN(Date.now() + 600);
      const [showdownGamePda] = deriveGamePda(showdownGameId);

      const twoPlayers = playerKeys.slice(0, 2);

      await program.methods
        .createGameTest(showdownGameId, new BN(6), twoPlayers, WAGER)
        .accountsPartial({
          authority: authority.publicKey,
          game: showdownGamePda,
          ...getHandAccounts(showdownGameId),
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const deck = generateShuffledDeck();
      await program.methods
        .dealCards(Buffer.from(deck))
        .accountsPartial({
          authority: authority.publicKey,
          game: showdownGamePda,
          ...getHandAccounts(showdownGameId),
        })
        .signers([authority])
        .rpc();

      // Fold player to trigger showdown
      await program.methods
        .playerAction(0, new BN(0)) // Fold
        .accountsPartial({
          authority: authority.publicKey,
          game: showdownGamePda,
        })
        .signers([authority])
        .rpc();

      let game = await program.account.gameState.fetch(showdownGamePda);
      expect(JSON.stringify(game.phase)).to.equal(
        JSON.stringify({ showdown: {} })
      );

      // Use showdown_test (no permissions needed on devnet)
      await program.methods
        .showdownTest()
        .accountsPartial({
          authority: authority.publicKey,
          game: showdownGamePda,
          ...getHandAccounts(showdownGameId),
        })
        .signers([authority])
        .rpc();

      game = await program.account.gameState.fetch(showdownGamePda);
      expect(JSON.stringify(game.phase)).to.equal(
        JSON.stringify({ complete: {} })
      );
      expect(game.winnerIndex).to.be.lessThan(2);
    });
  });

  describe("full hand lifecycle", () => {
    it("runs a complete hand from creation to showdown", async () => {
      const lifecycleGameId = new BN(Date.now() + 700);
      const [lifecycleGamePda] = deriveGamePda(lifecycleGameId);

      const twoPlayers = playerKeys.slice(0, 2);

      await program.methods
        .createGameTest(lifecycleGameId, new BN(7), twoPlayers, WAGER)
        .accountsPartial({
          authority: authority.publicKey,
          game: lifecycleGamePda,
          ...getHandAccounts(lifecycleGameId),
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      let game = await program.account.gameState.fetch(lifecycleGamePda);
      expect(JSON.stringify(game.phase)).to.equal(
        JSON.stringify({ waiting: {} })
      );

      const deck = generateShuffledDeck();
      await program.methods
        .dealCards(Buffer.from(deck))
        .accountsPartial({
          authority: authority.publicKey,
          game: lifecycleGamePda,
          ...getHandAccounts(lifecycleGameId),
        })
        .signers([authority])
        .rpc();

      game = await program.account.gameState.fetch(lifecycleGamePda);
      expect(JSON.stringify(game.phase)).to.equal(
        JSON.stringify({ preflop: {} })
      );

      const playRound = async () => {
        for (let i = 0; i < 4; i++) {
          game = await program.account.gameState.fetch(lifecycleGamePda);
          const phase = JSON.stringify(game.phase);

          if (
            phase === JSON.stringify({ showdown: {} }) ||
            phase === JSON.stringify({ complete: {} })
          ) {
            return;
          }

          const playerIdx = game.currentPlayer;
          if (game.playerStatus[playerIdx] !== 1) return;

          if (
            game.playerBets[playerIdx].toNumber() ===
            game.currentBet.toNumber()
          ) {
            await program.methods
              .playerAction(1, new BN(0)) // Check
              .accountsPartial({
                authority: authority.publicKey,
                game: lifecycleGamePda,
              })
              .signers([authority])
              .rpc();
          } else {
            await program.methods
              .playerAction(2, new BN(0)) // Call
              .accountsPartial({
                authority: authority.publicKey,
                game: lifecycleGamePda,
              })
              .signers([authority])
              .rpc();
          }
        }
      };

      for (let round = 0; round < 4; round++) {
        game = await program.account.gameState.fetch(lifecycleGamePda);
        const phase = JSON.stringify(game.phase);
        if (
          phase === JSON.stringify({ showdown: {} }) ||
          phase === JSON.stringify({ complete: {} })
        ) {
          break;
        }
        await playRound();
      }

      game = await program.account.gameState.fetch(lifecycleGamePda);
      const phase = JSON.stringify(game.phase);

      if (
        phase === JSON.stringify({ showdown: {} }) ||
        phase === JSON.stringify({ river: {} })
      ) {
        await program.methods
          .showdownTest()
          .accountsPartial({
            authority: authority.publicKey,
            game: lifecycleGamePda,
            ...getHandAccounts(lifecycleGameId),
          })
          .signers([authority])
          .rpc();
      }

      game = await program.account.gameState.fetch(lifecycleGamePda);
      expect(JSON.stringify(game.phase)).to.equal(
        JSON.stringify({ complete: {} })
      );
      expect(game.winnerIndex).to.be.lessThan(2);
    });
  });
});
