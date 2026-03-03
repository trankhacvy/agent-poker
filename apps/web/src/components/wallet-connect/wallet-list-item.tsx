"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WalletIcon } from "./wallet-icon";

export interface WalletListItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  name: string;
  icon?: string;
  selected?: boolean;
  recent?: boolean;
  installed?: boolean;
}

export function WalletListItem({
  className,
  name,
  icon,
  selected,
  recent,
  installed,
  ...props
}: WalletListItemProps) {
  return (
    <Button
      variant="ghost"
      type="button"
      className={cn(
        "h-auto w-full justify-start gap-3 px-3 py-2.5 font-medium",
        selected &&
          "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
        className
      )}
      {...props}
    >
      <WalletIcon name={name} icon={icon} size={28} />
      <span className="flex-1 text-left">{name}</span>
      {!selected && recent && <span className="text-muted-foreground text-xs">Recent</span>}
      {!selected && installed && !recent && (
        <span className="text-muted-foreground text-xs">Installed</span>
      )}
    </Button>
  );
}
