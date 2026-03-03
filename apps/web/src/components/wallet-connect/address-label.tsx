"use client";

import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AddressLabelProps extends React.HTMLAttributes<HTMLButtonElement> {
  address: string;
  truncateChars?: number;
  copyable?: boolean;
}

function truncateAddress(address: string, chars: number): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function AddressLabel({
  className,
  address,
  truncateChars = 4,
  copyable = true,
  ...props
}: AddressLabelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!copyable) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address, copyable]);

  const displayAddress = truncateAddress(address, truncateChars);

  if (!copyable) {
    return <span className={cn("font-mono text-sm", className)}>{displayAddress}</span>;
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "hover:text-foreground/80 inline-flex items-center gap-1.5 font-mono text-sm transition-colors",
        className
      )}
      {...props}
    >
      {displayAddress}
      {copied ? (
        <Check className="size-3.5 text-green-500" />
      ) : (
        <Copy className="text-muted-foreground size-3.5" />
      )}
    </button>
  );
}
