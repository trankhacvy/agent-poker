"use client";

import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { AGENT_PROGRAM_ID } from "@/lib/constants";
import type { AgentData } from "@/lib/types";

interface UseAgentProgramReturn {
  createAgent: (templateId: number, displayName: string) => Promise<string | null>;
  fundAgent: (agentPublicKey: string, lamports: number) => Promise<boolean>;
  withdraw: (agentPublicKey: string, lamports: number) => Promise<boolean>;
  getAgent: (agentPublicKey: string) => Promise<AgentData | null>;
  loading: boolean;
  error: string | null;
}

export function useAgentProgram(): UseAgentProgramReturn {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createAgent = useCallback(
    async (templateId: number, displayName: string): Promise<string | null> => {
      if (!publicKey) {
        setError("Wallet not connected");
        return null;
      }
      setLoading(true);
      setError(null);
      try {
        const programId = new PublicKey(AGENT_PROGRAM_ID);
        const [agentPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("agent"),
            publicKey.toBuffer(),
            Buffer.from(displayName),
          ],
          programId
        );

        const data = Buffer.alloc(64);
        data.writeUInt8(0, 0);
        data.writeUInt8(templateId, 1);
        const nameBytes = Buffer.from(displayName);
        data.writeUInt8(nameBytes.length, 2);
        nameBytes.copy(data, 3);

        const instruction = {
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: agentPda, isSigner: false, isWritable: true },
            {
              pubkey: SystemProgram.programId,
              isSigner: false,
              isWritable: false,
            },
          ],
          programId,
          data,
        };

        const transaction = new Transaction().add(instruction);
        const signature = await sendTransaction(transaction, connection);
        await connection.confirmTransaction(signature);
        return agentPda.toBase58();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create agent";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [publicKey, sendTransaction, connection]
  );

  const fundAgent = useCallback(
    async (agentPublicKey: string, lamports: number): Promise<boolean> => {
      if (!publicKey) {
        setError("Wallet not connected");
        return false;
      }
      setLoading(true);
      setError(null);
      try {
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(agentPublicKey),
            lamports,
          })
        );
        const signature = await sendTransaction(transaction, connection);
        await connection.confirmTransaction(signature);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fund agent";
        setError(message);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [publicKey, sendTransaction, connection]
  );

  const withdraw = useCallback(
    async (agentPublicKey: string, lamports: number): Promise<boolean> => {
      if (!publicKey) {
        setError("Wallet not connected");
        return false;
      }
      setLoading(true);
      setError(null);
      try {
        const programId = new PublicKey(AGENT_PROGRAM_ID);
        const data = Buffer.alloc(9);
        data.writeUInt8(2, 0);
        data.writeBigUInt64LE(BigInt(lamports), 1);

        const instruction = {
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            {
              pubkey: new PublicKey(agentPublicKey),
              isSigner: false,
              isWritable: true,
            },
          ],
          programId,
          data,
        };

        const transaction = new Transaction().add(instruction);
        const signature = await sendTransaction(transaction, connection);
        await connection.confirmTransaction(signature);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to withdraw";
        setError(message);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [publicKey, sendTransaction, connection]
  );

  const getAgent = useCallback(
    async (agentPublicKey: string): Promise<AgentData | null> => {
      try {
        const accountInfo = await connection.getAccountInfo(
          new PublicKey(agentPublicKey)
        );
        if (!accountInfo) return null;

        const data = accountInfo.data;
        return {
          publicKey: agentPublicKey,
          owner: new PublicKey(data.subarray(8, 40)).toBase58(),
          displayName: Buffer.from(data.subarray(40, 60))
            .toString("utf-8")
            .replace(/\0/g, ""),
          templateId: data[60],
          balance: Number(data.readBigUInt64LE(61)) / 1e9,
          gamesPlayed: data.readUInt32LE(69),
          wins: data.readUInt32LE(73),
          earnings: Number(data.readBigInt64LE(77)) / 1e9,
          createdAt: Number(data.readBigInt64LE(85)),
        };
      } catch {
        return null;
      }
    },
    [connection]
  );

  return { createAgent, fundAgent, withdraw, getAgent, loading, error };
}
