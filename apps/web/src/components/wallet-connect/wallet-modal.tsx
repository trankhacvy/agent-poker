"use client";

import { useState, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useWalletConnectors, useConnectWallet, type WalletConnectorId } from "@solana/connector";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "./use-media-query";
import { useRecentWallets } from "./use-recent-wallets";
import { useWalletInstallInfo } from "./wallet-info-context";
import { WalletListPanel } from "./wallet-list-panel";
import { WalletDetailPanel, type DetailView } from "./wallet-detail-panel";
import type { WalletInstallInfo } from "./wallet-install-info";

export type ModalView = "list" | DetailView;

export interface WalletModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  walletInstallInfo?: WalletInstallInfo[];
}

function InstallInfoResolver({
  connectorId,
  children,
}: {
  connectorId: string;
  children: (info: WalletInstallInfo | undefined) => React.ReactNode;
}) {
  const info = useWalletInstallInfo(connectorId);
  return <>{children(info)}</>;
}

export function WalletModal({ open, onOpenChange, className }: WalletModalProps) {
  const isDesktop = useIsDesktop();
  const connectors = useWalletConnectors();
  const { connect, error, resetError } = useConnectWallet();
  const { recentWallets, addRecentWallet } = useRecentWallets();

  const [view, setView] = useState<ModalView>("list");
  const [selectedConnectorId, setSelectedConnectorId] = useState<WalletConnectorId | null>(null);
  const [connectError, setConnectError] = useState<Error | null>(null);

  const connectingRef = useRef<WalletConnectorId | null>(null);

  const selectedConnector = connectors.find((c) => c.id === selectedConnectorId);

  // Reset state when modal closes
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setView("list");
        setSelectedConnectorId(null);
        setConnectError(null);
        connectingRef.current = null;
        resetError();
      }
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, resetError]
  );

  const handleSelectWallet = useCallback(
    async (connectorId: WalletConnectorId) => {
      setSelectedConnectorId(connectorId);
      setConnectError(null);
      connectingRef.current = connectorId;

      const connector = connectors.find((c) => c.id === connectorId);
      if (connector && !connector.ready) {
        // Wallet not installed — show install view
        setView("install");
        return;
      }

      setView("connecting");

      try {
        await connect(connectorId);
        // Stale check
        if (connectingRef.current !== connectorId) return;
        addRecentWallet(connectorId);
        handleOpenChange(false);
      } catch (err) {
        // Stale check
        if (connectingRef.current !== connectorId) return;
        setConnectError(err instanceof Error ? err : new Error("Connection failed"));
        setView("error");
      }
    },
    [connect, connectors, addRecentWallet, handleOpenChange]
  );

  const handleRetry = useCallback(() => {
    if (selectedConnectorId) {
      handleSelectWallet(selectedConnectorId);
    }
  }, [selectedConnectorId, handleSelectWallet]);

  const handleBack = useCallback(() => {
    if (view === "get-started") {
      setView("install");
    } else {
      setView("list");
      setSelectedConnectorId(null);
      setConnectError(null);
      connectingRef.current = null;
      resetError();
    }
  }, [view, resetError]);

  // Determine the detail view for desktop (default to get-wallet when nothing selected)
  const detailView: DetailView = view === "list" ? "get-wallet" : view;

  // Mobile header title
  const mobileTitle =
    view === "list"
      ? "Connect a Wallet"
      : view === "get-wallet"
        ? "What is a Wallet?"
        : view === "connecting"
          ? `Connecting to ${selectedConnector?.name ?? "Wallet"}`
          : view === "error"
            ? "Connection Failed"
            : view === "install"
              ? `Install ${selectedConnector?.name ?? "Wallet"}`
              : view === "get-started"
                ? `Get Started`
                : "Connect a Wallet";

  const detailPanel = (
    <InstallInfoResolver connectorId={selectedConnectorId ?? ""}>
      {(installInfo) => (
        <WalletDetailPanel
          view={detailView}
          walletName={selectedConnector?.name}
          walletIcon={selectedConnector?.icon}
          error={connectError ?? error ?? null}
          installInfo={installInfo}
          onRetry={handleRetry}
          onGetStarted={() => setView("get-started")}
          onBackToInstall={() => setView("install")}
        />
      )}
    </InstallInfoResolver>
  );

  // Desktop: two-panel Dialog
  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className={cn("gap-0 overflow-hidden p-0 sm:max-w-[680px]", className)}
          style={
            {
              "--tw-enter-translate-x": "0",
              "--tw-enter-translate-y": "0",
              "--tw-exit-translate-x": "0",
              "--tw-exit-translate-y": "0",
            } as React.CSSProperties
          }
        >
          <DialogTitle className="sr-only">Connect a Wallet</DialogTitle>
          <DialogDescription className="sr-only">
            Choose a wallet to connect to this app.
          </DialogDescription>
          <div className="flex h-[440px]">
            {/* Left panel: wallet list */}
            <div className="flex w-[240px] flex-col border-r">
              <div className="px-6 pt-5 pb-2">
                <h2 className="text-sm font-semibold">Connect a Wallet</h2>
              </div>
              <WalletListPanel
                className="flex-1"
                connectors={connectors}
                recentWallets={recentWallets}
                selectedConnectorId={selectedConnectorId}
                onSelect={handleSelectWallet}
              />
            </div>
            {/* Right panel: detail */}
            <div className="flex-1">{detailPanel}</div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Mobile: single-column Sheet
  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className={cn("rounded-t-xl p-0", className)}>
        <div className="flex max-h-[85vh] flex-col">
          {/* Header */}
          <SheetHeader className="flex-row items-center gap-2 border-b px-4 py-3">
            {view !== "list" && (
              <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={handleBack}>
                <ChevronLeft className="size-4" />
                <span className="sr-only">Back</span>
              </Button>
            )}
            <SheetTitle className="flex-1 text-sm font-semibold">{mobileTitle}</SheetTitle>
            <SheetDescription className="sr-only">
              Choose a wallet to connect to this app.
            </SheetDescription>
          </SheetHeader>

          {/* Content */}
          {view === "list" ? (
            <WalletListPanel
              className="flex-1 overflow-auto"
              connectors={connectors}
              recentWallets={recentWallets}
              selectedConnectorId={selectedConnectorId}
              onSelect={(id) => {
                handleSelectWallet(id);
              }}
            />
          ) : (
            <div className="flex-1 overflow-auto">{detailPanel}</div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
