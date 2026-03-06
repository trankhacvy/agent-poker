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
import { AgentPokerEscrow } from "../target/types/agent_poker_escrow";
import { fundKeypair, fundKeypairs } from "./helpers";

describe("agent_poker_escrow", () => {
  const provider = new anchor.AnchorProvider(
    anchor.AnchorProvider.env().connection,
    anchor.AnchorProvider.env().wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace
    .agentPokerEscrow as Program<AgentPokerEscrow>;

  const authority = Keypair.generate();
  const depositors: Keypair[] = [];
  const DEPOSIT_AMOUNT = new BN(0.005 * LAMPORTS_PER_SOL);
  let sessionId: BN;

  function deriveSessionPda(id: BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("session"), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  }

  function deriveSessionVaultPda(id: BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("session_vault"), id.toArrayLike(Buffer, "le", 8)],
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
    await fundKeypair(provider, authority);

    for (let i = 0; i < 6; i++) {
      const depositor = Keypair.generate();
      depositors.push(depositor);
    }
    await fundKeypairs(provider, depositors);

    sessionId = new BN(Date.now());
  });

  describe("initialize_treasury", () => {
    it("initializes the treasury PDA", async () => {
      const [treasuryPda] = deriveTreasuryPda();

      try {
        await program.methods
          .initializeTreasury()
          .accountsPartial({
            authority: authority.publicKey,
            treasury: treasuryPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([authority])
          .rpc();
      } catch (err) {
        const errStr = String(err);
        if (!errStr.includes("already in use")) {
          throw err;
        }
      }

      const treasuryInfo =
        await provider.connection.getAccountInfo(treasuryPda);
      expect(treasuryInfo).to.not.be.null;
    });
  });

  describe("create_session", () => {
    it("creates a session with valid game type", async () => {
      const [sessionPda] = deriveSessionPda(sessionId);
      const [sessionVaultPda] = deriveSessionVaultPda(sessionId);

      await program.methods
        .createSession(sessionId, 0) // game_type 0 = poker
        .accountsPartial({
          authority: authority.publicKey,
          session: sessionPda,
          sessionVault: sessionVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const session = await program.account.session.fetch(sessionPda);
      expect(session.sessionId.toString()).to.equal(sessionId.toString());
      expect(session.gameType).to.equal(0);
      expect(session.depositCount).to.equal(0);
      expect(session.totalDeposited.toNumber()).to.equal(0);
      expect(session.authority.toBase58()).to.equal(
        authority.publicKey.toBase58()
      );
      expect(JSON.stringify(session.status)).to.equal(
        JSON.stringify({ open: {} })
      );
    });
  });

  describe("deposit", () => {
    it("allows 6 depositors to deposit", async () => {
      const [sessionPda] = deriveSessionPda(sessionId);
      const [sessionVaultPda] = deriveSessionVaultPda(sessionId);

      for (let i = 0; i < 6; i++) {
        const depositor = depositors[i];

        await program.methods
          .deposit(DEPOSIT_AMOUNT)
          .accountsPartial({
            depositor: depositor.publicKey,
            session: sessionPda,
            sessionVault: sessionVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([depositor])
          .rpc();

        const session = await program.account.session.fetch(sessionPda);
        expect(session.depositCount).to.equal(i + 1);
        expect(session.depositors[i].toBase58()).to.equal(
          depositor.publicKey.toBase58()
        );
        expect(session.deposits[i].toNumber()).to.equal(
          DEPOSIT_AMOUNT.toNumber()
        );
      }

      const session = await program.account.session.fetch(sessionPda);
      expect(session.depositCount).to.equal(6);
      expect(session.totalDeposited.toNumber()).to.equal(
        DEPOSIT_AMOUNT.toNumber() * 6
      );
    });

    it("rejects duplicate depositor", async () => {
      const [sessionPda] = deriveSessionPda(sessionId);
      const [sessionVaultPda] = deriveSessionVaultPda(sessionId);

      try {
        await program.methods
          .deposit(DEPOSIT_AMOUNT)
          .accountsPartial({
            depositor: depositors[0].publicKey,
            session: sessionPda,
            sessionVault: sessionVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([depositors[0]])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as anchor.AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("AlreadyDeposited");
      }
    });
  });

  describe("lock_session", () => {
    it("transitions Open session to Locked", async () => {
      const [sessionPda] = deriveSessionPda(sessionId);

      await program.methods
        .lockSession()
        .accountsPartial({
          authority: authority.publicKey,
          session: sessionPda,
        })
        .signers([authority])
        .rpc();

      const session = await program.account.session.fetch(sessionPda);
      expect(JSON.stringify(session.status)).to.equal(
        JSON.stringify({ locked: {} })
      );
    });

    it("rejects locking a non-open session", async () => {
      const [sessionPda] = deriveSessionPda(sessionId);

      try {
        await program.methods
          .lockSession()
          .accountsPartial({
            authority: authority.publicKey,
            session: sessionPda,
          })
          .signers([authority])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as anchor.AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("SessionNotOpen");
      }
    });
  });

  describe("settle", () => {
    it("pays winner 95% and treasury 5%", async () => {
      const [sessionPda] = deriveSessionPda(sessionId);
      const [sessionVaultPda] = deriveSessionVaultPda(sessionId);
      const [treasuryPda] = deriveTreasuryPda();

      const session = await program.account.session.fetch(sessionPda);
      const totalDeposited = session.totalDeposited.toNumber();
      const rake = Math.floor((totalDeposited * 500) / 10_000);
      const distributable = totalDeposited - rake;

      // Winner gets all distributable
      const winner = depositors[0];
      const payouts = [
        { recipient: winner.publicKey, amount: new BN(distributable) },
      ];

      const treasuryBefore =
        await provider.connection.getBalance(treasuryPda);
      const winnerBefore = await provider.connection.getBalance(
        winner.publicKey
      );

      await program.methods
        .settle(payouts)
        .accountsPartial({
          authority: authority.publicKey,
          session: sessionPda,
          sessionVault: sessionVaultPda,
          treasury: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          {
            pubkey: winner.publicKey,
            isSigner: false,
            isWritable: true,
          },
        ])
        .signers([authority])
        .rpc();

      const treasuryAfter =
        await provider.connection.getBalance(treasuryPda);
      const winnerAfter = await provider.connection.getBalance(
        winner.publicKey
      );

      expect(treasuryAfter - treasuryBefore).to.equal(rake);
      expect(winnerAfter - winnerBefore).to.equal(distributable);

      const settled = await program.account.session.fetch(sessionPda);
      expect(JSON.stringify(settled.status)).to.equal(
        JSON.stringify({ settled: {} })
      );
    });
  });

  describe("refund_session", () => {
    it("returns deposits to all depositors", async () => {
      const refundSessionId = new BN(Date.now() + 5000);
      const [sessionPda] = deriveSessionPda(refundSessionId);
      const [sessionVaultPda] = deriveSessionVaultPda(refundSessionId);

      await program.methods
        .createSession(refundSessionId, 0)
        .accountsPartial({
          authority: authority.publicKey,
          session: sessionPda,
          sessionVault: sessionVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const joinCount = 3;
      for (let i = 0; i < joinCount; i++) {
        await program.methods
          .deposit(DEPOSIT_AMOUNT)
          .accountsPartial({
            depositor: depositors[i].publicKey,
            session: sessionPda,
            sessionVault: sessionVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([depositors[i]])
          .rpc();
      }

      const balancesBefore: number[] = [];
      const remainingAccounts: anchor.web3.AccountMeta[] = [];
      for (let i = 0; i < joinCount; i++) {
        balancesBefore.push(
          await provider.connection.getBalance(depositors[i].publicKey)
        );
        remainingAccounts.push({
          pubkey: depositors[i].publicKey,
          isSigner: false,
          isWritable: true,
        });
      }

      await program.methods
        .refundSession()
        .accountsPartial({
          authority: authority.publicKey,
          session: sessionPda,
          sessionVault: sessionVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .signers([authority])
        .rpc();

      for (let i = 0; i < joinCount; i++) {
        const balanceAfter = await provider.connection.getBalance(
          depositors[i].publicKey
        );
        expect(balanceAfter - balancesBefore[i]).to.equal(
          DEPOSIT_AMOUNT.toNumber()
        );
      }

      const session = await program.account.session.fetch(sessionPda);
      expect(JSON.stringify(session.status)).to.equal(
        JSON.stringify({ cancelled: {} })
      );
      expect(session.depositCount).to.equal(0);
    });
  });
});
