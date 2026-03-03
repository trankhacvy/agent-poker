"use client";

import { useSyncExternalStore } from "react";
import { MOBILE_BREAKPOINT } from "./wallet-install-info";

export function useMediaQuery(query?: string) {
  const resolvedQuery = query ?? `(min-width: ${MOBILE_BREAKPOINT}px)`;

  return useSyncExternalStore(
    (callback) => {
      const mql = window.matchMedia(resolvedQuery);
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
    () => window.matchMedia(resolvedQuery).matches,
    () => false
  );
}

export function useIsDesktop() {
  return useMediaQuery();
}
