"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { type WalletInstallInfo, getWalletInstallInfo } from "./wallet-install-info";

interface WalletInstallInfoContextValue {
  overrides: WalletInstallInfo[];
}

const WalletInstallInfoContext = createContext<WalletInstallInfoContextValue | null>(null);

export interface WalletInstallInfoProviderProps {
  children: ReactNode;
  walletInstallInfo?: WalletInstallInfo[];
}

export function WalletInstallInfoProvider({
  children,
  walletInstallInfo,
}: WalletInstallInfoProviderProps) {
  const value = useMemo(() => ({ overrides: walletInstallInfo ?? [] }), [walletInstallInfo]);

  return (
    <WalletInstallInfoContext.Provider value={value}>{children}</WalletInstallInfoContext.Provider>
  );
}

export function useWalletInstallInfo(connectorId: string): WalletInstallInfo | undefined {
  const ctx = useContext(WalletInstallInfoContext);
  return getWalletInstallInfo(connectorId, ctx?.overrides);
}
