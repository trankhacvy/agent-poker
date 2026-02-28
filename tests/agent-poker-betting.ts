import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";
import { AgentPokerBetting } from "../target/types/agent_poker_betting";
import { fundKeypairs } from "./helpers";

describe("agent_poker_betting", () => {
  const provider = new anchor.AnchorProvider(
    anchor.AnchorProvider.env().connection,
    anchor.AnchorProvider.env().wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace
    .agentPokerBetting as Program<AgentPokerBetting>;

  const authority = Keypair.generate();
  const bettorA = Keypair.generate();
  const bettorB = Keypair.generate();
  const bettorC = Keypair.generate();

  const agents = Array.from({ length: 6 }, () => Keypair.generate().publicKey);
  const tableId = new BN(Date.now());
  const BET_AMOUNT = new BN(0.01 * LAMPORTS_PER_SOL);

  let poolPda: PublicKey;
  let poolVaultPda: PublicKey;
  let treasuryPda: PublicKey;

  function derivePoolPda(id: BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bet_pool"), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  }

  function derivePoolVaultPda(pool: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), pool.toBuffer()],
      program.programId
    );
  }

  function deriveBetPda(
    pool: PublicKey,
    bettor: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bet"), pool.toBuffer(), bettor.toBuffer()],
      program.programId
    );
  }

  function deriveTreasuryPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      program.programId
    );
  }

  before(async () => {
    await fundKeypairs(provider, [authority, bettorA, bettorB, bettorC]);

    [poolPda] = derivePoolPda(tableId);
    [poolVaultPda] = derivePoolVaultPda(poolPda);
    [treasuryPda] = deriveTreasuryPda();
  });

  describe("create_pool", () => {
    it("creates a betting pool", async () => {
      await program.methods
        .createPool(tableId, agents)
        .accountsPartial({
          authority: authority.publicKey,
          pool: poolPda,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const pool = await program.account.bettingPool.fetch(poolPda);
      expect(pool.tableId.toString()).to.equal(tableId.toString());
      expect(pool.totalPool.toNumber()).to.equal(0);
      expect(pool.betCount).to.equal(0);
      expect(JSON.stringify(pool.status)).to.equal(
        JSON.stringify({ open: {} })
      );
      expect(pool.authority.toBase58()).to.equal(
        authority.publicKey.toBase58()
      );
    });
  });

  describe("place_bet", () => {
    it("transfers SOL to pool vault", async () => {
      const [betPda] = deriveBetPda(poolPda, bettorA.publicKey);

      const vaultBefore = await provider.connection.getBalance(poolVaultPda);

      await program.methods
        .placeBet(0, BET_AMOUNT)
        .accountsPartial({
          bettor: bettorA.publicKey,
          pool: poolPda,
          poolVault: poolVaultPda,
          bet: betPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([bettorA])
        .rpc();

      const vaultAfter = await provider.connection.getBalance(poolVaultPda);
      expect(vaultAfter - vaultBefore).to.equal(BET_AMOUNT.toNumber());

      const bet = await program.account.betAccount.fetch(betPda);
      expect(bet.bettor.toBase58()).to.equal(bettorA.publicKey.toBase58());
      expect(bet.agentIndex).to.equal(0);
      expect(bet.amount.toNumber()).to.equal(BET_AMOUNT.toNumber());
      expect(bet.claimed).to.equal(false);

      const pool = await program.account.bettingPool.fetch(poolPda);
      expect(pool.totalPool.toNumber()).to.equal(BET_AMOUNT.toNumber());
      expect(pool.betCount).to.equal(1);
    });

    it("allows multiple bettors", async () => {
      const [betPdaB] = deriveBetPda(poolPda, bettorB.publicKey);

      await program.methods
        .placeBet(0, BET_AMOUNT)
        .accountsPartial({
          bettor: bettorB.publicKey,
          pool: poolPda,
          poolVault: poolVaultPda,
          bet: betPdaB,
          systemProgram: SystemProgram.programId,
        })
        .signers([bettorB])
        .rpc();

      const [betPdaC] = deriveBetPda(poolPda, bettorC.publicKey);

      await program.methods
        .placeBet(1, BET_AMOUNT)
        .accountsPartial({
          bettor: bettorC.publicKey,
          pool: poolPda,
          poolVault: poolVaultPda,
          bet: betPdaC,
          systemProgram: SystemProgram.programId,
        })
        .signers([bettorC])
        .rpc();

      const pool = await program.account.bettingPool.fetch(poolPda);
      expect(pool.betCount).to.equal(3);
      expect(pool.totalPool.toNumber()).to.equal(BET_AMOUNT.toNumber() * 3);
    });
  });

  describe("lock_pool", () => {
    it("transitions to Locked status", async () => {
      await program.methods
        .lockPool()
        .accountsPartial({
          authority: authority.publicKey,
          pool: poolPda,
        })
        .signers([authority])
        .rpc();

      const pool = await program.account.bettingPool.fetch(poolPda);
      expect(JSON.stringify(pool.status)).to.equal(
        JSON.stringify({ locked: {} })
      );
    });
  });

  describe("settle_pool", () => {
    it("sets winner and transfers rake to treasury", async () => {
      const treasuryBefore = await provider.connection.getBalance(treasuryPda);
      const winnerIndex = 0;

      await program.methods
        .settlePool(winnerIndex)
        .accountsPartial({
          authority: authority.publicKey,
          pool: poolPda,
          poolVault: poolVaultPda,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const pool = await program.account.bettingPool.fetch(poolPda);
      expect(JSON.stringify(pool.status)).to.equal(
        JSON.stringify({ settled: {} })
      );
      expect(pool.winnerIndex).to.equal(winnerIndex);

      const totalPool = BET_AMOUNT.toNumber() * 3;
      const expectedRake = Math.floor((totalPool * 500) / 10_000);

      const treasuryAfter = await provider.connection.getBalance(treasuryPda);
      expect(treasuryAfter - treasuryBefore).to.equal(expectedRake);
    });
  });

  describe("claim_winnings", () => {
    it("pays pro-rata to winner bettor", async () => {
      const [betPdaA] = deriveBetPda(poolPda, bettorA.publicKey);

      const bettorBalanceBefore = await provider.connection.getBalance(
        bettorA.publicKey
      );

      const totalPool = BET_AMOUNT.toNumber() * 3;
      const rake = Math.floor((totalPool * 500) / 10_000);
      const poolAfterRake = totalPool - rake;
      const winningPoolTotal = BET_AMOUNT.toNumber() * 2;
      const expectedPayout = Math.floor(
        (BET_AMOUNT.toNumber() * poolAfterRake) / winningPoolTotal
      );

      await program.methods
        .claimWinnings(new BN(winningPoolTotal))
        .accountsPartial({
          bettor: bettorA.publicKey,
          pool: poolPda,
          poolVault: poolVaultPda,
          bet: betPdaA,
          systemProgram: SystemProgram.programId,
        })
        .signers([bettorA])
        .rpc();

      const bettorBalanceAfter = await provider.connection.getBalance(
        bettorA.publicKey
      );
      expect(bettorBalanceAfter - bettorBalanceBefore).to.be.greaterThan(0);

      const bet = await program.account.betAccount.fetch(betPdaA);
      expect(bet.claimed).to.equal(true);
    });

    it("rejects non-winner claim", async () => {
      const [betPdaC] = deriveBetPda(poolPda, bettorC.publicKey);

      try {
        await program.methods
          .claimWinnings(new BN(BET_AMOUNT.toNumber()))
          .accountsPartial({
            bettor: bettorC.publicKey,
            pool: poolPda,
            poolVault: poolVaultPda,
            bet: betPdaC,
            systemProgram: SystemProgram.programId,
          })
          .signers([bettorC])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as anchor.AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("BetNotOnWinner");
      }
    });

    it("rejects double claim", async () => {
      const [betPdaA] = deriveBetPda(poolPda, bettorA.publicKey);

      try {
        await program.methods
          .claimWinnings(new BN(BET_AMOUNT.toNumber() * 2))
          .accountsPartial({
            bettor: bettorA.publicKey,
            pool: poolPda,
            poolVault: poolVaultPda,
            bet: betPdaA,
            systemProgram: SystemProgram.programId,
          })
          .signers([bettorA])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as anchor.AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("AlreadyClaimed");
      }
    });
  });
});
