import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";
import { AgentPokerAgent } from "../target/types/agent_poker_agent";
import { fundKeypair } from "./helpers";

describe("agent_poker_agent", () => {
  const provider = new anchor.AnchorProvider(
    anchor.AnchorProvider.env().connection,
    anchor.AnchorProvider.env().wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace
    .agentPokerAgent as Program<AgentPokerAgent>;

  const owner = Keypair.generate();

  function deriveAgentPda(ownerKey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), ownerKey.toBuffer()],
      program.programId
    );
  }

  function deriveVaultPda(ownerKey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent_vault"), ownerKey.toBuffer()],
      program.programId
    );
  }

  before(async () => {
    await fundKeypair(provider, owner);
  });

  describe("create_agent", () => {
    it("creates an agent with valid template and display name", async () => {
      const [agentPda] = deriveAgentPda(owner.publicKey);
      const [vaultPda] = deriveVaultPda(owner.publicKey);

      await program.methods
        .createAgent(2, "TestAgent")
        .accountsPartial({
          owner: owner.publicKey,
          agent: agentPda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.owner.toBase58()).to.equal(owner.publicKey.toBase58());
      expect(agent.template).to.equal(2);
      expect(agent.displayName).to.equal("TestAgent");
      expect(agent.vault.toBase58()).to.equal(vaultPda.toBase58());
      expect(agent.totalGames.toNumber()).to.equal(0);
      expect(agent.totalWins.toNumber()).to.equal(0);
      expect(agent.totalEarnings.toNumber()).to.equal(0);
    });

    it("rejects invalid template (>3)", async () => {
      const badOwner = Keypair.generate();
      await fundKeypair(provider, badOwner);

      const [agentPda] = deriveAgentPda(badOwner.publicKey);
      const [vaultPda] = deriveVaultPda(badOwner.publicKey);

      try {
        await program.methods
          .createAgent(5, "BadTemplate")
          .accountsPartial({
            owner: badOwner.publicKey,
            agent: agentPda,
            vault: vaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([badOwner])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as anchor.AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("InvalidTemplate");
      }
    });

    it("rejects name too long (>20 chars)", async () => {
      const badOwner = Keypair.generate();
      await fundKeypair(provider, badOwner);

      const [agentPda] = deriveAgentPda(badOwner.publicKey);
      const [vaultPda] = deriveVaultPda(badOwner.publicKey);

      try {
        await program.methods
          .createAgent(1, "ThisNameIsWayTooLongForTheLimit")
          .accountsPartial({
            owner: badOwner.publicKey,
            agent: agentPda,
            vault: vaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([badOwner])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as anchor.AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("NameTooLong");
      }
    });
  });

  describe("fund_agent", () => {
    it("transfers SOL to vault", async () => {
      const [agentPda] = deriveAgentPda(owner.publicKey);
      const [vaultPda] = deriveVaultPda(owner.publicKey);

      const vaultBalanceBefore = await provider.connection.getBalance(vaultPda);
      const fundAmount = new BN(0.01 * LAMPORTS_PER_SOL);

      await program.methods
        .fundAgent(fundAmount)
        .accountsPartial({
          owner: owner.publicKey,
          agent: agentPda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      const vaultBalanceAfter = await provider.connection.getBalance(vaultPda);
      expect(vaultBalanceAfter - vaultBalanceBefore).to.equal(
        0.01 * LAMPORTS_PER_SOL
      );
    });
  });

  describe("withdraw", () => {
    it("transfers SOL from vault to owner", async () => {
      const [agentPda] = deriveAgentPda(owner.publicKey);
      const [vaultPda] = deriveVaultPda(owner.publicKey);

      const ownerBalanceBefore = await provider.connection.getBalance(
        owner.publicKey
      );
      const withdrawAmount = new BN(0.005 * LAMPORTS_PER_SOL);

      await program.methods
        .withdraw(withdrawAmount)
        .accountsPartial({
          owner: owner.publicKey,
          agent: agentPda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

      const ownerBalanceAfter = await provider.connection.getBalance(
        owner.publicKey
      );
      expect(ownerBalanceAfter).to.be.greaterThan(ownerBalanceBefore);
    });

    it("fails with insufficient funds", async () => {
      const [agentPda] = deriveAgentPda(owner.publicKey);
      const [vaultPda] = deriveVaultPda(owner.publicKey);

      const hugeAmount = new BN(999 * LAMPORTS_PER_SOL);

      try {
        await program.methods
          .withdraw(hugeAmount)
          .accountsPartial({
            owner: owner.publicKey,
            agent: agentPda,
            vault: vaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as anchor.AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("InsufficientFunds");
      }
    });
  });

  describe("update_stats", () => {
    it("increments stats correctly", async () => {
      const [agentPda] = deriveAgentPda(owner.publicKey);

      await program.methods
        .updateStats(
          new BN(3),
          new BN(1),
          new BN(500_000)
        )
        .accountsPartial({
          authority: provider.wallet.publicKey,
          agent: agentPda,
        })
        .rpc();

      const agent = await program.account.agentAccount.fetch(agentPda);
      expect(agent.totalGames.toNumber()).to.equal(3);
      expect(agent.totalWins.toNumber()).to.equal(1);
      expect(agent.totalEarnings.toNumber()).to.equal(500_000);

      await program.methods
        .updateStats(
          new BN(2),
          new BN(1),
          new BN(200_000)
        )
        .accountsPartial({
          authority: provider.wallet.publicKey,
          agent: agentPda,
        })
        .rpc();

      const agentUpdated = await program.account.agentAccount.fetch(agentPda);
      expect(agentUpdated.totalGames.toNumber()).to.equal(5);
      expect(agentUpdated.totalWins.toNumber()).to.equal(2);
      expect(agentUpdated.totalEarnings.toNumber()).to.equal(700_000);
    });
  });
});
