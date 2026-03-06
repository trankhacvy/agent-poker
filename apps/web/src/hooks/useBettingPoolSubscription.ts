"use client";

import { useAccountSubscription } from "./useAccountSubscription";
import {
  decodeBettingPool,
  type BettingPool,
} from "@repo/program-clients/betting";
import { SOLANA_RPC_URL, SOLANA_WS_URL } from "@/lib/constants";
import type { Address } from "@solana/kit";

export function useBettingPoolSubscription(poolPda: Address | null) {
  return useAccountSubscription<BettingPool>({
    rpcUrl: SOLANA_RPC_URL,
    wsUrl: SOLANA_WS_URL,
    address: poolPda,
    decode: decodeBettingPool,
    enabled: !!poolPda,
  });
}
