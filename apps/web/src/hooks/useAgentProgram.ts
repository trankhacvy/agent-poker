"use client";

import { useCallback, useState } from "react";
import {
  useAccount,
  useSolanaClient,
  useKitTransactionSigner,
  useTransactionPreparer,
} from "@solana/connector";
import {
  address,
  getProgramDerivedAddress,
  getAddressEncoder,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  AccountRole,
  type Instruction,
} from "@solana/kit";
import { AGENT_PROGRAM_ID } from "@/lib/constants";
import type { AgentData } from "@/lib/types";

const PROGRAM_ADDRESS = address(AGENT_PROGRAM_ID);
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

interface UseAgentProgramReturn {
  createAgent: (templateId: number, displayName: string) => Promise<string | null>;
  fundAgent: (agentPublicKey: string, lamports: number) => Promise<boolean>;
  withdraw: (agentPublicKey: string, lamports: number) => Promise<boolean>;
  getAgent: (agentPublicKey: string) => Promise<AgentData | null>;
  loading: boolean;
  error: string | null;
}

export function useAgentProgram(): UseAgentProgramReturn {
  const { address: walletAddress } = useAccount();
  const { client } = useSolanaClient();
  const { signer } = useKitTransactionSigner();
  const { prepare } = useTransactionPreparer();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendTransaction = useCallback(
    async (instruction: Instruction) => {
      if (!signer || !client) throw new Error("Wallet not connected");

      const txMsg = pipe(
        createTransactionMessage({ version: 0 }),
        (msg) => setTransactionMessageFeePayerSigner(signer, msg),
        (msg) => appendTransactionMessageInstruction(instruction, msg),
      );

      const prepared = await prepare(txMsg);
      const signed = await signTransactionMessageWithSigners(prepared);
      const wireTransaction = getBase64EncodedWireTransaction(signed);
      await client.rpc
        .sendTransaction(wireTransaction, { encoding: "base64" })
        .send();
    },
    [signer, client, prepare]
  );

  const createAgent = useCallback(
    async (templateId: number, displayName: string): Promise<string | null> => {
      if (!walletAddress || !signer) {
        setError("Wallet not connected");
        return null;
      }
      setLoading(true);
      setError(null);
      try {
        const walletAddr = address(walletAddress);
        const addressEncoder = getAddressEncoder();

        const [agentPda] = await getProgramDerivedAddress({
          programAddress: PROGRAM_ADDRESS,
          seeds: [
            new TextEncoder().encode("agent"),
            addressEncoder.encode(walletAddr),
            new TextEncoder().encode(displayName),
          ],
        });

        const data = new Uint8Array(64);
        data[0] = 0;
        data[1] = templateId;
        const nameBytes = new TextEncoder().encode(displayName);
        data[2] = nameBytes.length;
        data.set(nameBytes, 3);

        const instruction: Instruction = {
          programAddress: PROGRAM_ADDRESS,
          accounts: [
            { address: walletAddr, role: AccountRole.WRITABLE_SIGNER },
            { address: agentPda, role: AccountRole.WRITABLE },
            { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
          ],
          data,
        };

        await sendTransaction(instruction);
        return agentPda;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create agent";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [walletAddress, signer, sendTransaction]
  );

  const fundAgent = useCallback(
    async (agentPublicKey: string, lamports: number): Promise<boolean> => {
      if (!walletAddress || !signer) {
        setError("Wallet not connected");
        return false;
      }
      setLoading(true);
      setError(null);
      try {
        const walletAddr = address(walletAddress);

        // SystemProgram.transfer instruction
        const data = new Uint8Array(12);
        const view = new DataView(data.buffer);
        view.setUint32(0, 2, true); // transfer instruction index
        view.setBigUint64(4, BigInt(lamports), true);

        const instruction: Instruction = {
          programAddress: SYSTEM_PROGRAM,
          accounts: [
            { address: walletAddr, role: AccountRole.WRITABLE_SIGNER },
            { address: address(agentPublicKey), role: AccountRole.WRITABLE },
          ],
          data,
        };

        await sendTransaction(instruction);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fund agent";
        setError(message);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [walletAddress, signer, sendTransaction]
  );

  const withdraw = useCallback(
    async (agentPublicKey: string, lamports: number): Promise<boolean> => {
      if (!walletAddress || !signer) {
        setError("Wallet not connected");
        return false;
      }
      setLoading(true);
      setError(null);
      try {
        const walletAddr = address(walletAddress);

        const data = new Uint8Array(9);
        data[0] = 2;
        const view = new DataView(data.buffer);
        view.setBigUint64(1, BigInt(lamports), true);

        const instruction: Instruction = {
          programAddress: PROGRAM_ADDRESS,
          accounts: [
            { address: walletAddr, role: AccountRole.WRITABLE_SIGNER },
            { address: address(agentPublicKey), role: AccountRole.WRITABLE },
          ],
          data,
        };

        await sendTransaction(instruction);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to withdraw";
        setError(message);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [walletAddress, signer, sendTransaction]
  );

  const getAgent = useCallback(
    async (agentPublicKey: string): Promise<AgentData | null> => {
      if (!client) return null;
      try {
        const result = await client.rpc
          .getAccountInfo(address(agentPublicKey), { encoding: "base64" })
          .send();

        if (!result.value) return null;

        const data = Buffer.from(result.value.data[0], "base64");
        return {
          publicKey: agentPublicKey,
          owner: address(
            Buffer.from(data.subarray(8, 40)).toString("hex")
          ),
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
    [client]
  );

  return { createAgent, fundAgent, withdraw, getAgent, loading, error };
}
