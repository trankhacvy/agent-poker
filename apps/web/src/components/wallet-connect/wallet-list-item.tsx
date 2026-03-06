"use client";

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
    <button
      type="button"
      className={cn(
        "flex h-auto w-full items-center justify-start gap-3 rounded-xl px-3 py-2.5 font-medium text-sm transition-colors cursor-pointer",
        selected
          ? "bg-violet/15 text-violet"
          : "text-neutral-100 hover:bg-neutral-500/50 hover:text-neutral-50",
        className
      )}
      {...props}
    >
      <WalletIcon name={name} icon={icon} size={28} />
      <span className="flex-1 text-left">{name}</span>
      {!selected && recent && <span className="text-neutral-300 text-xs">Recent</span>}
      {!selected && installed && !recent && (
        <span className="text-neutral-300 text-xs">Installed</span>
      )}
    </button>
  );
}
