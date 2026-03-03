"use client";

import { useCallback, useSyncExternalStore } from "react";
import { RECENT_WALLETS_KEY, MAX_RECENT_WALLETS } from "./wallet-install-info";

const EMPTY: string[] = [];

let cachedSnapshot: string[] = EMPTY;

function getSnapshot(): string[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const stored = localStorage.getItem(RECENT_WALLETS_KEY);
    if (!stored) return EMPTY;
    const parsed = JSON.parse(stored) as string[];
    // Only update reference if content changed
    if (parsed.length !== cachedSnapshot.length || parsed.some((v, i) => v !== cachedSnapshot[i])) {
      cachedSnapshot = parsed;
    }
    return cachedSnapshot;
  } catch {
    return EMPTY;
  }
}

function getServerSnapshot(): string[] {
  return EMPTY;
}

let listeners: Array<() => void> = [];

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function useRecentWallets() {
  const recentWallets = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const addRecentWallet = useCallback((connectorId: string) => {
    const current = getSnapshot();
    const updated = [connectorId, ...current.filter((id) => id !== connectorId)].slice(
      0,
      MAX_RECENT_WALLETS
    );

    localStorage.setItem(RECENT_WALLETS_KEY, JSON.stringify(updated));
    emitChange();
  }, []);

  const clearRecentWallets = useCallback(() => {
    localStorage.removeItem(RECENT_WALLETS_KEY);
    emitChange();
  }, []);

  return { recentWallets, addRecentWallet, clearRecentWallets } as const;
}
