import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";
import { AgentPokerEscrow } from "../target/types/agent_poker_escrow";
import { AgentPokerAgent } from "../target/types/agent_poker_agent";
import { fundKeypair, fundKeypairs } from "./helpers";

describe("agent_poker_escrow", () => {
  const provider = new anchor.AnchorProvider(
    anchor.AnchorProvider.env().connection,
    anchor.AnchorProvider.env().wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const escrowProgram = anchor.workspace
    .agentPokerEscrow as Program<AgentPokerEscrow>;
  const agentProgram = anchor.workspace
    .agentPokerAgent as Program<AgentPokerAgent>;

  const authority = Keypair.generate();
  const players: Keypair[] = [];
  const WAGER_TIER = new BN(0.005 * LAMPORTS_PER_SOL);
  let tableId: BN;

  function deriveTablePda(id: BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("table"), id.toArrayLike(Buffer, "le", 8)],
      escrowProgram.programId
    );
  }

  function deriveTableVaultPda(id: BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("table_vault"), id.toArrayLike(Buffer, "le", 8)],
      escrowProgram.programId
    );
  }

  function deriveTreasuryPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("treasury")],
      escrowProgram.programId
    );
  }

  function deriveAgentPda(ownerKey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), ownerKey.toBuffer()],
      agentProgram.programId
    );
  }

  function deriveAgentVaultPda(ownerKey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent_vault"), ownerKey.toBuffer()],
      agentProgram.programId
    );
  }

  before(async () => {
    await fundKeypair(provider, authority);

    for (let i = 0; i < 6; i++) {
      const player = Keypair.generate();
      players.push(player);
    }

    await fundKeypairs(provider, players);

    for (let i = 0; i < 6; i++) {
      const player = players[i];
      const [agentPda] = deriveAgentPda(player.publicKey);
      const [vaultPda] = deriveAgentVaultPda(player.publicKey);

      await agentProgram.methods
        .createAgent(i % 4, `Player${i}`)
        .accountsPartial({
          owner: player.publicKey,
          agent: agentPda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc();

      await agentProgram.methods
        .fundAgent(new BN(0.02 * LAMPORTS_PER_SOL))
        .accountsPartial({
          owner: player.publicKey,
          agent: agentPda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc();
    }

    tableId = new BN(Date.now());
  });

  describe("initialize_treasury", () => {
    it("initializes the treasury PDA", async () => {
      const [treasuryPda] = deriveTreasuryPda();

      try {
        await escrowProgram.methods
          .initializeTreasury()
          .accountsPartial({
            authority: authority.publicKey,
            treasury: treasuryPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
      } catch (err) {
        // Treasury may already exist from a previous devnet run — that's OK
        const errStr = String(err);
        if (!errStr.includes("already in use")) {
          throw err;
        }
      }

      const treasuryInfo = await provider.connection.getAccountInfo(
        treasuryPda
      );
      expect(treasuryInfo).to.not.be.null;
    });
  });

  describe("create_table", () => {
    it("creates a table with valid wager tier", async () => {
      const [tablePda] = deriveTablePda(tableId);
      const [tableVaultPda] = deriveTableVaultPda(tableId);

      await escrowProgram.methods
        .createTable(tableId, WAGER_TIER)
        .accountsPartial({
          authority: authority.publicKey,
          table: tablePda,
          tableVault: tableVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const table = await escrowProgram.account.tableEscrow.fetch(tablePda);
      expect(table.tableId.toString()).to.equal(tableId.toString());
      expect(table.wagerTier.toString()).to.equal(WAGER_TIER.toString());
      expect(table.playerCount).to.equal(0);
      expect(table.authority.toBase58()).to.equal(
        authority.publicKey.toBase58()
      );
      expect(JSON.stringify(table.status)).to.equal(
        JSON.stringify({ open: {} })
      );
    });
  });

  describe("join_table", () => {
    it("allows 6 players to join and auto-transitions to Full", async () => {
      const [tablePda] = deriveTablePda(tableId);
      const [tableVaultPda] = deriveTableVaultPda(tableId);

      for (let i = 0; i < 6; i++) {
        const player = players[i];
        const [, agentVaultBump] = deriveAgentVaultPda(player.publicKey);
        const [agentVaultPda] = deriveAgentVaultPda(player.publicKey);

        await escrowProgram.methods
          .joinTable(agentVaultBump)
          .accountsPartial({
            agentOwner: player.publicKey,
            table: tablePda,
            tableVault: tableVaultPda,
            agentVault: agentVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([player])
          .rpc();

        const table = await escrowProgram.account.tableEscrow.fetch(tablePda);
        expect(table.playerCount).to.equal(i + 1);
      }

      const table = await escrowProgram.account.tableEscrow.fetch(tablePda);
      expect(table.playerCount).to.equal(6);
      expect(JSON.stringify(table.status)).to.equal(
        JSON.stringify({ full: {} })
      );
    });
  });

  describe("start_game", () => {
    it("requires Full status", async () => {
      const openTableId = new BN(Date.now() + 999);
      const [openTablePda] = deriveTablePda(openTableId);
      const [openTableVaultPda] = deriveTableVaultPda(openTableId);

      await escrowProgram.methods
        .createTable(openTableId, WAGER_TIER)
        .accountsPartial({
          authority: authority.publicKey,
          table: openTablePda,
          tableVault: openTableVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      try {
        await escrowProgram.methods
          .startGame()
          .accountsPartial({
            authority: authority.publicKey,
            table: openTablePda,
          })
          .signers([authority])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as anchor.AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("TableNotFull");
      }
    });

    it("transitions Full table to InProgress", async () => {
      const [tablePda] = deriveTablePda(tableId);

      await escrowProgram.methods
        .startGame()
        .accountsPartial({
          authority: authority.publicKey,
          table: tablePda,
        })
        .signers([authority])
        .rpc();

      const table = await escrowProgram.account.tableEscrow.fetch(tablePda);
      expect(JSON.stringify(table.status)).to.equal(
        JSON.stringify({ inProgress: {} })
      );
    });
  });

  describe("settle_table", () => {
    it("pays winner 95% and treasury 5%", async () => {
      const [tablePda] = deriveTablePda(tableId);
      const [tableVaultPda] = deriveTableVaultPda(tableId);
      const [treasuryPda] = deriveTreasuryPda();

      const winnerIndex = 0;
      const winner = players[winnerIndex];
      const [winnerVaultPda] = deriveAgentVaultPda(winner.publicKey);

      const treasuryBefore = await provider.connection.getBalance(treasuryPda);
      const winnerVaultBefore = await provider.connection.getBalance(
        winnerVaultPda
      );

      await escrowProgram.methods
        .settleTable(winnerIndex)
        .accountsPartial({
          authority: authority.publicKey,
          table: tablePda,
          tableVault: tableVaultPda,
          winnerVault: winnerVaultPda,
          treasury: treasuryPda,
        })
        .signers([authority])
        .rpc();

      const totalPot = WAGER_TIER.toNumber() * 6;
      const expectedRake = Math.floor((totalPot * 500) / 10_000);
      const expectedWinnerPayout = totalPot - expectedRake;

      const treasuryAfter = await provider.connection.getBalance(treasuryPda);
      const winnerVaultAfter = await provider.connection.getBalance(
        winnerVaultPda
      );

      expect(treasuryAfter - treasuryBefore).to.equal(expectedRake);
      expect(winnerVaultAfter - winnerVaultBefore).to.equal(
        expectedWinnerPayout
      );

      const table = await escrowProgram.account.tableEscrow.fetch(tablePda);
      expect(JSON.stringify(table.status)).to.equal(
        JSON.stringify({ settled: {} })
      );
      expect(table.winner.toBase58()).to.equal(winner.publicKey.toBase58());
    });
  });

  describe("refund_table", () => {
    it("returns wagers to all players", async () => {
      const refundTableId = new BN(Date.now() + 5000);
      const [tablePda] = deriveTablePda(refundTableId);
      const [tableVaultPda] = deriveTableVaultPda(refundTableId);

      await escrowProgram.methods
        .createTable(refundTableId, WAGER_TIER)
        .accountsPartial({
          authority: authority.publicKey,
          table: tablePda,
          tableVault: tableVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const joinCount = 3;
      for (let i = 0; i < joinCount; i++) {
        const player = players[i];
        const [, agentVaultBump] = deriveAgentVaultPda(player.publicKey);
        const [agentVaultPda] = deriveAgentVaultPda(player.publicKey);

        await escrowProgram.methods
          .joinTable(agentVaultBump)
          .accountsPartial({
            agentOwner: player.publicKey,
            table: tablePda,
            tableVault: tableVaultPda,
            agentVault: agentVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([player])
          .rpc();
      }

      const vaultsBefore: number[] = [];
      const remainingAccounts: anchor.web3.AccountMeta[] = [];
      for (let i = 0; i < joinCount; i++) {
        const [agentVaultPda] = deriveAgentVaultPda(players[i].publicKey);
        vaultsBefore.push(await provider.connection.getBalance(agentVaultPda));
        remainingAccounts.push({
          pubkey: agentVaultPda,
          isSigner: false,
          isWritable: true,
        });
      }

      await escrowProgram.methods
        .refundTable()
        .accountsPartial({
          authority: authority.publicKey,
          table: tablePda,
          tableVault: tableVaultPda,
        })
        .remainingAccounts(remainingAccounts)
        .signers([authority])
        .rpc();

      for (let i = 0; i < joinCount; i++) {
        const [agentVaultPda] = deriveAgentVaultPda(players[i].publicKey);
        const vaultAfter = await provider.connection.getBalance(agentVaultPda);
        expect(vaultAfter - vaultsBefore[i]).to.equal(WAGER_TIER.toNumber());
      }

      const table = await escrowProgram.account.tableEscrow.fetch(tablePda);
      expect(JSON.stringify(table.status)).to.equal(
        JSON.stringify({ settled: {} })
      );
      expect(table.playerCount).to.equal(0);
    });
  });
});
