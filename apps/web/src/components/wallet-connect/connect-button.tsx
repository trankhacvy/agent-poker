"use client";

import { Button } from "@/components/ui/button";
import { useWallet, useWalletInfo, useAccount } from "@solana/connector";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWalletModal } from "./use-wallet-modal";
import { WalletModal } from "./wallet-modal";
import { AccountDropdown } from "./account-dropdown";
import { ClusterSelector } from "./cluster-selector";
import { WalletIcon } from "./wallet-icon";

export interface ConnectButtonProps {
  connectLabel?: string;
  className?: string;
  showBalance?: boolean;
  showCluster?: boolean;
  showExplorer?: boolean;
}

export function ConnectButton({
  connectLabel = "Connect Wallet",
  className,
  showBalance = true,
  showCluster = true,
  showExplorer = true,
}: ConnectButtonProps) {
  const { isConnected, isConnecting } = useWallet();
  const { name, icon } = useWalletInfo();
  const { formatted } = useAccount();
  const { open, setOpen, openModal } = useWalletModal();

  // Connecting state
  if (isConnecting) {
    return (
      <>
        <Button variant="outline" disabled className={cn("gap-2", className)}>
          <Loader2 className="size-4 animate-spin" />
          Connecting...
        </Button>
        <WalletModal open={open} onOpenChange={setOpen} />
      </>
    );
  }

  // Connected state
  if (isConnected) {
    return (
      <div className="flex items-center gap-2">
        <AccountDropdown
          showBalance={showBalance}
          showCluster={false}
          showExplorer={showExplorer}
          trigger={
            <Button variant="outline" className={cn("gap-2", className)}>
              <WalletIcon name={name ?? undefined} icon={icon ?? undefined} size={20} />
              <span className="font-mono text-sm">{formatted}</span>
            </Button>
          }
        />
        {showCluster && <ClusterSelector className="w-[130px]" />}
      </div>
    );
  }

  // Disconnected state
  return (
    <>
      <Button onClick={openModal} className={className}>
        {connectLabel}
      </Button>
      <WalletModal open={open} onOpenChange={setOpen} />
    </>
  );
}
