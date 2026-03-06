"use client";

import { useEffect, useState, useMemo } from "react";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  fetchEncodedAccount,
  getBase64Encoder,
  type Address,
  type MaybeEncodedAccount,
} from "@solana/kit";
import { decodePlayerHand } from "@repo/program-clients/game";
import { derivePlayerHandPda } from "@/lib/pda";
import { ER_RPC_URL, ER_WS_URL } from "@/lib/constants";

export function usePlayerHandsSubscription(
  gameId: string | null,
  playerCount: number
): Map<number, [number, number]> {
  const [hands, setHands] = useState<Map<number, [number, number]>>(new Map());

  const rpc = useMemo(() => createSolanaRpc(ER_RPC_URL), []);
  const rpcSubscriptions = useMemo(
    () => createSolanaRpcSubscriptions(ER_WS_URL),
    []
  );

  useEffect(() => {
    if (!gameId || playerCount === 0) {
      setHands(new Map());
      return;
    }

    let cancelled = false;
    const abortControllers: AbortController[] = [];

    async function subscribeToHand(seatIndex: number) {
      const handPda = await derivePlayerHandPda(gameId!, seatIndex);
      const abortController = new AbortController();
      abortControllers.push(abortController);

      // Initial fetch
      try {
        const encoded = await fetchEncodedAccount(rpc, handPda);
        const decoded = decodePlayerHand(encoded);
        if (decoded.exists && !cancelled) {
          const h = Array.from(decoded.data.hand);
          if (h[0] !== 255) {
            setHands((prev) => {
              const next = new Map(prev);
              next.set(seatIndex, [h[0]!, h[1]!]);
              return next;
            });
          }
        }
      } catch {
        // Hand may not exist yet
      }

      // Subscribe
      try {
        const notifications = await rpcSubscriptions
          .accountNotifications(handPda, {
            commitment: "confirmed",
            encoding: "base64",
          })
          .subscribe({ abortSignal: abortController.signal });

        for await (const notification of notifications) {
          if (cancelled) break;
          try {
            const encodedData = getBase64Encoder().encode(
              notification.value.data[0] as string
            );
            const encoded: MaybeEncodedAccount<string> = {
              address: handPda,
              exists: true,
              executable: notification.value.executable,
              lamports: notification.value.lamports,
              programAddress: notification.value.owner as Address,
              space: BigInt(encodedData.length),
              data: encodedData as unknown as Uint8Array,
            };
            const decoded = decodePlayerHand(encoded) as import("@solana/kit").MaybeAccount<import("@repo/program-clients/game").PlayerHand, string>;
            if (decoded.exists) {
              const h = Array.from(decoded.data.hand);
              if (h[0] !== 255) {
                setHands((prev) => {
                  const next = new Map(prev);
                  next.set(seatIndex, [h[0]!, h[1]!]);
                  return next;
                });
              }
            }
          } catch {
            // decode error
          }
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          console.error(`PlayerHand ${seatIndex} subscription error:`, err);
        }
      }
    }

    for (let i = 0; i < playerCount; i++) {
      subscribeToHand(i);
    }

    return () => {
      cancelled = true;
      for (const ac of abortControllers) {
        ac.abort();
      }
    };
  }, [gameId, playerCount, rpc, rpcSubscriptions]);

  return hands;
}
