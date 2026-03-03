"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl, Keypair } from "@solana/web3.js";
import { DevWalletAdapter } from "@/lib/dev-wallet-adapter";
import "@solana/wallet-adapter-react-ui/styles.css";

function DevWalletAutoConnect() {
  const { select, connect, connected, wallet } = useWallet();
  useEffect(() => {
    if (!connected && !wallet) {
      select("Dev Wallet" as any);
    }
  }, [connected, wallet, select]);
  useEffect(() => {
    if (wallet && !connected) {
      connect().catch(() => {});
    }
  }, [wallet, connected, connect]);
  return null;
}

interface WalletProviderProps {
  children: ReactNode;
}

export default function WalletProvider({ children }: WalletProviderProps) {
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("devnet"),
    []
  );

  // const wallets = useMemo(() => {
  //   const w = [];
  //   const secret = process.env.NEXT_PUBLIC_DEV_WALLET_SECRET;
  //   if (secret) {
  //     try {
  //       const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  //       w.push(new DevWalletAdapter(keypair));
  //       console.log("[DevWallet] Loaded dev wallet:", keypair.publicKey.toBase58());
  //     } catch (e) {
  //       console.error("[DevWallet] Failed to parse NEXT_PUBLIC_DEV_WALLET_SECRET:", e);
  //     }
  //   }
  //   return w;
  // }, []);

  // const isDevWallet = wallets.length > 0;

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={[]} autoConnect>
        {/* {isDevWallet && <DevWalletAutoConnect />} */}
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
