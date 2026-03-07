"use client";

import { useCallback, useState } from "react";
import { useAccount, useConnectorClient, useKitTransactionSigner } from "@solana/connector";
import {
  getProgramDerivedAddress,
  getU64Encoder,
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  assertIsTransactionWithBlockhashLifetime,
  sendAndConfirmTransactionFactory,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getSignatureFromTransaction,
  type Address,
} from "@solana/kit";
import {
  getPlaceBetInstructionAsync,
  getClaimWinningsInstructionAsync,
} from "@repo/program-clients/betting";
import { BETTING_PROGRAM_ID } from "@/lib/constants";

const PROGRAM_ADDRESS = address(BETTING_PROGRAM_ID);
const POOL_SEED = new TextEncoder().encode("bet_pool");

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

interface UseBettingProgramReturn {
  placeBetOnChain: (
    tableId: string,
    agentIndex: number,
    amountLamports: number
  ) => Promise<string | null>;
  claimWinnings: (tableId: string) => Promise<string | null>;
  loading: boolean;
  error: string | null;
}

export function useBettingProgram(): UseBettingProgramReturn {
  const { address: walletAddress } = useAccount();
  const client = useConnectorClient();
  const { signer } = useKitTransactionSigner();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildAndSend = useCallback(
    async (kitIx: any): Promise<string> => {
      if (!client || !signer) throw new Error("Wallet not connected");

      const rpcUrl = client.getRpcUrl();
      if (!rpcUrl) throw new Error("No RPC endpoint configured");
      const rpc = createSolanaRpc(rpcUrl);
      const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace("http", "ws"));
      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

      const txMsg = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(signer, tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        (tx) => appendTransactionMessageInstructions([kitIx], tx)
      );

      const signedTransaction = await signTransactionMessageWithSigners(txMsg);
      assertIsTransactionWithBlockhashLifetime(signedTransaction);
      const signature = getSignatureFromTransaction(signedTransaction);

      await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signedTransaction, {
        commitment: "confirmed",
        skipPreflight: false,
      });

      return signature;
    },
    [client, signer]
  );

  const placeBetOnChain = useCallback(
    async (tableId: string, agentIndex: number, amountLamports: number): Promise<string | null> => {
      if (!walletAddress || !client || !signer) {
        setError("Wallet not connected");
        return null;
      }
      setLoading(true);
      setError(null);
      try {
        const poolPda = await derivePoolPda(tableId);
        const kitIx = await getPlaceBetInstructionAsync({
          bettor: signer,
          pool: poolPda,
          agentIndex,
          amount: BigInt(amountLamports),
        });
        return await buildAndSend(kitIx);
      } catch (err: any) {
        console.error("placeBetOnChain error:", err);
        const message = err instanceof Error ? err.message : "Failed to place bet on-chain";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [walletAddress, client, signer, buildAndSend]
  );

  const claimWinnings = useCallback(
    async (tableId: string): Promise<string | null> => {
      if (!walletAddress || !client || !signer) {
        setError("Wallet not connected");
        return null;
      }
      setLoading(true);
      setError(null);
      try {
        const poolPda = await derivePoolPda(tableId);
        const kitIx = await getClaimWinningsInstructionAsync({
          bettor: signer,
          pool: poolPda,
        });
        return await buildAndSend(kitIx);
      } catch (err: any) {
        console.error("claimWinnings error:", err);
        const message = err instanceof Error ? err.message : "Failed to claim winnings";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [walletAddress, client, signer, buildAndSend]
  );

  return { placeBetOnChain, claimWinnings, loading, error };
}
