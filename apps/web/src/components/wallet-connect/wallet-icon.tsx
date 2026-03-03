"use client";

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface WalletIconProps extends React.ComponentProps<typeof Avatar> {
  name?: string;
  icon?: string;
  size?: number;
}

export function WalletIcon({ className, name, icon, size = 28, ...props }: WalletIconProps) {
  return (
    <Avatar
      className={cn("shrink-0 rounded-md", className)}
      style={{ width: size, height: size }}
      {...props}
    >
      <AvatarImage src={icon} alt={name ?? "Wallet"} />
      <AvatarFallback className="rounded-md text-xs">
        {name?.slice(0, 2).toUpperCase() ?? "??"}
      </AvatarFallback>
    </Avatar>
  );
}
