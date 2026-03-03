"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { WalletIcon } from "./wallet-icon";

export interface ConnectingAnimationProps extends React.HTMLAttributes<HTMLDivElement> {
  walletName?: string;
  walletIcon?: string;
}

export function ConnectingAnimation({
  className,
  walletName,
  walletIcon,
  ...props
}: ConnectingAnimationProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-4 py-8", className)}
      {...props}
    >
      <div className="relative">
        {walletIcon ? (
          <WalletIcon name={walletName} icon={walletIcon} size={64} />
        ) : (
          <Loader2 className="text-primary size-12 animate-spin" />
        )}
      </div>
      {walletName && <p className="text-sm font-medium">{walletName}</p>}
      <div className="flex items-center gap-2">
        {walletIcon && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
        <p className="text-muted-foreground text-sm">Waiting for connection...</p>
      </div>
    </div>
  );
}
