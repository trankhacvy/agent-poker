"use client";

import { useState, useMemo, type ReactNode } from "react";
import { AppProvider, getDefaultConfig } from "@solana/connector";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletInstallInfoProvider } from "./wallet-info-context";
import type { WalletInstallInfo } from "./wallet-install-info";

export interface SolanaWalletProviderProps {
  children: ReactNode;
  appName?: string;
  cluster?: "mainnet-beta" | "mainnet" | "devnet" | "testnet" | "localnet";
  walletConnectProjectId?: string;
  autoConnect?: boolean;
  queryClient?: QueryClient;
  walletInstallInfo?: WalletInstallInfo[];
}

export function SolanaWalletProvider({
  children,
  appName = "My App",
  cluster = "mainnet-beta",
  walletConnectProjectId,
  autoConnect = true,
  queryClient: externalQueryClient,
  walletInstallInfo,
}: SolanaWalletProviderProps) {
  const [internalQueryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
          },
        },
      })
  );

  const config = useMemo(
    () =>
      getDefaultConfig({
        appName,
        network: cluster,
        autoConnect,
        walletConnect: walletConnectProjectId
          ? {
              projectId: walletConnectProjectId,
              metadata: {
                name: appName,
                description: appName,
                url: typeof window !== "undefined" ? window.location.origin : "",
                icons: [],
              },
            }
          : undefined,
      }),
    [appName, cluster, autoConnect, walletConnectProjectId]
  );

  const qc = externalQueryClient ?? internalQueryClient;

  return (
    <QueryClientProvider client={qc}>
      <AppProvider connectorConfig={config}>
        <WalletInstallInfoProvider walletInstallInfo={walletInstallInfo}>
          {children}
        </WalletInstallInfoProvider>
      </AppProvider>
    </QueryClientProvider>
  );
}
