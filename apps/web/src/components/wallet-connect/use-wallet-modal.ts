"use client";

import { useCallback, useState } from "react";

export function useWalletModal(initialOpen = false) {
  const [open, setOpen] = useState(initialOpen);

  const openModal = useCallback(() => setOpen(true), []);
  const closeModal = useCallback(() => setOpen(false), []);

  return { open, setOpen, openModal, closeModal } as const;
}
