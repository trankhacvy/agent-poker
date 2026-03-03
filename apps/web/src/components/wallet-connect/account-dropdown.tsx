"use client";

import { type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useAccount,
  useBalance,
  useWalletInfo,
  useDisconnectWallet,
  useCluster,
} from "@solana/connector";
import { ExternalLink, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { WalletIcon } from "./wallet-icon";
import { AddressLabel } from "./address-label";
import { BalanceDisplay } from "./balance-display";
import { ClusterSelector } from "./cluster-selector";

export interface AccountDropdownProps {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showBalance?: boolean;
  showCluster?: boolean;
  showExplorer?: boolean;
  className?: string;
  children?: ReactNode;
}

export function AccountDropdown({
  trigger,
  open,
  onOpenChange,
  showBalance = true,
  showCluster = true,
  showExplorer = true,
  className,
  children,
}: AccountDropdownProps) {
  const { address } = useAccount();
  const { lamports } = useBalance();
  const { name, icon } = useWalletInfo();
  const { disconnect } = useDisconnectWallet();
  const { explorerUrl } = useCluster();

  if (!address) return null;

  const explorerAccountUrl = `${explorerUrl}/address/${address}`;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn("w-[280px]", className)}>
        <DropdownMenuLabel className="flex items-center gap-3 font-normal">
          <WalletIcon name={name ?? undefined} icon={icon ?? undefined} size={32} />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{name}</span>
            <AddressLabel address={address} className="text-muted-foreground text-xs" />
          </div>
        </DropdownMenuLabel>

        {showBalance && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <BalanceDisplay lamports={lamports} />
            </div>
          </>
        )}

        {showCluster && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <label className="text-muted-foreground mb-1 block text-xs">Network</label>
              <ClusterSelector />
            </div>
          </>
        )}

        {showExplorer && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={explorerAccountUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 size-4" />
                View on Explorer
              </a>
            </DropdownMenuItem>
          </>
        )}

        {children && (
          <>
            <DropdownMenuSeparator />
            {children}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => disconnect()}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 size-4" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
