"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  fetchEncodedAccount,
  getBase64Encoder,
  type Address,
  type MaybeAccount,
  type MaybeEncodedAccount,
} from "@solana/kit";

interface UseAccountSubscriptionOptions<T extends object> {
  rpcUrl: string;
  wsUrl: string;
  address: Address | null;
  decode: (encoded: MaybeEncodedAccount<string>) => MaybeAccount<T, string>;
  enabled?: boolean;
}

interface UseAccountSubscriptionReturn<T extends object> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function useAccountSubscription<T extends object>({
  rpcUrl,
  wsUrl,
  address,
  decode,
  enabled = true,
}: UseAccountSubscriptionOptions<T>): UseAccountSubscriptionReturn<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const rpc = useMemo(() => createSolanaRpc(rpcUrl), [rpcUrl]);
  const rpcSubscriptions = useMemo(
    () => createSolanaRpcSubscriptions(wsUrl),
    [wsUrl]
  );

  // Use ref for decode to avoid re-running effect when decode reference changes
  const decodeRef = useRef(decode);
  decodeRef.current = decode;

  useEffect(() => {
    if (!address || !enabled) {
      setData(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();

    setLoading(true);
    setError(null);

    // 1. Initial fetch
    fetchEncodedAccount(rpc, address)
      .then((encoded) => {
        if (cancelled) return;
        const decoded = decodeRef.current(encoded);
        if (decoded.exists) {
          setData(decoded.data);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Initial account fetch failed:", err);
        setLoading(false);
      });

    // 2. Subscribe to changes
    rpcSubscriptions
      .accountNotifications(address, {
        commitment: "confirmed",
        encoding: "base64",
      })
      .subscribe({ abortSignal: abortController.signal })
      .then(async (notifications) => {
        for await (const notification of notifications) {
          if (cancelled) break;
          try {
            const encodedData = getBase64Encoder().encode(
              notification.value.data[0] as string
            );
            const encoded: MaybeEncodedAccount<string> = {
              address,
              exists: true,
              executable: notification.value.executable,
              lamports: notification.value.lamports,
              programAddress: notification.value.owner as Address,
              space: BigInt(encodedData.length),
              data: encodedData as unknown as Uint8Array,
            };
            const decoded = decodeRef.current(encoded);
            if (decoded.exists) {
              setData(decoded.data);
            }
          } catch (err) {
            console.error("Account notification decode error:", err);
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled && err?.name !== "AbortError") {
          console.error("Account subscription error:", err);
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [rpc, rpcSubscriptions, address, enabled]);

  return { data, loading, error };
}
