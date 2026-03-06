"use client";

import { useAccountSubscription } from "./useAccountSubscription";
import { decodeGameState, type GameState } from "@repo/program-clients/game";
import { ER_RPC_URL, ER_WS_URL } from "@/lib/constants";
import type { Address } from "@solana/kit";

export function useGameStateSubscription(gamePda: Address | null) {
  return useAccountSubscription<GameState>({
    rpcUrl: ER_RPC_URL,
    wsUrl: ER_WS_URL,
    address: gamePda,
    decode: decodeGameState,
    enabled: !!gamePda,
  });
}
