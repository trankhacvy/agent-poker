"use client";

import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  getProgramDerivedAddress,
  getU64Encoder,
  createNoopSigner,
  address,
  AccountRole,
  type Address,
  type IInstruction,
  type IAccountMeta,
} from "@solana/kit";
import { getPlaceBetInstructionAsync } from "@repo/program-clients/betting";
import { BETTING_PROGRAM_ID } from "@/lib/constants";

const PROGRAM_ADDRESS = address(BETTING_PROGRAM_ID);
const POOL_SEED = new TextEncoder().encode("bet_pool");

/**
 * Convert a UUID (or numeric string) to a u64 bigint,
 * matching the server's `toBn()` logic.
 */
function tableIdToU64(tableId: string): bigint {
  if (/^\d+$/.test(tableId)) return BigInt(tableId);
  return BigInt("0x" + tableId.replace(/-/g, "").slice(0, 16));
}

async function derivePoolPda(tableId: string): Promise<Address> {
  const tableIdBytes = getU64Encoder().encode(tableIdToU64(tableId));
  const [pda] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: [POOL_SEED, tableIdBytes],
  });
  return pda;
}

/**
 * Convert a Solana Kit instruction to a legacy web3.js TransactionInstruction.
 * @solana/compat only provides fromLegacy, not toLegacy.
 */
function toLegacyInstruction(ix: IInstruction): TransactionInstruction {
  const accounts = (ix.accounts ?? []) as IAccountMeta[];
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: accounts.map((acc) => ({
      pubkey: new PublicKey(acc.address),
      isSigner: acc.role >= AccountRole.READONLY_SIGNER,
      isWritable: acc.role === AccountRole.WRITABLE || acc.role === AccountRole.WRITABLE_SIGNER,
    })),
    data: Buffer.from(ix.data ?? new Uint8Array()),
  });
}

interface UseBettingProgramReturn {
  placeBetOnChain: (
    tableId: string,
    agentIndex: number,
    amountLamports: number
  ) => Promise<string | null>;
  loading: boolean;
  error: string | null;
}

export function useBettingProgram(): UseBettingProgramReturn {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeBetOnChain = useCallback(
    async (tableId: string, agentIndex: number, amountLamports: number): Promise<string | null> => {
      if (!publicKey) {
        setError("Wallet not connected");
        return null;
      }
      setLoading(true);
      setError(null);
      try {
        const bettorAddress = address(publicKey.toBase58());
        const poolPda = await derivePoolPda(tableId);

        // createNoopSigner provides an address for PDA derivation;
        // actual signing happens via wallet adapter's sendTransaction
        const bettorSigner = createNoopSigner(bettorAddress);

        // Build instruction using the generated SDK
        // Auto-derives poolVault and bet PDAs, encodes discriminator + args
        const kitIx = await getPlaceBetInstructionAsync({
          bettor: bettorSigner,
          pool: poolPda,
          agentIndex,
          amount: BigInt(amountLamports),
        });

        // Convert Kit instruction → legacy TransactionInstruction
        const legacyIx = toLegacyInstruction(kitIx);

        const transaction = new Transaction().add(legacyIx);
        console.log("transaction", transaction);
        const signature = await sendTransaction(transaction, connection);
        await connection.confirmTransaction(signature);
        return signature;
      } catch (err) {
        console.error("placeBetOnChain error:", err);
        const message = err instanceof Error ? err.message : "Failed to place bet on-chain";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [publicKey, sendTransaction, connection]
  );

  return { placeBetOnChain, loading, error };
}
