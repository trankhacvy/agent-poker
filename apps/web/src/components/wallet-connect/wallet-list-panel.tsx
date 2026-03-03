"use client";

import type { WalletConnectorId } from "@solana/connector";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { WalletListItem } from "./wallet-list-item";
import { POPULAR_WALLET_IDS } from "./wallet-install-info";

interface WalletConnector {
  id: WalletConnectorId;
  name: string;
  icon?: string;
  ready: boolean;
}

export interface WalletListPanelProps {
  connectors: WalletConnector[];
  recentWallets: string[];
  selectedConnectorId: WalletConnectorId | null;
  onSelect: (connectorId: WalletConnectorId) => void;
  className?: string;
}

function isPopular(connector: WalletConnector, recentWallets: string[]): boolean {
  const id = connector.id.toLowerCase();
  return (
    POPULAR_WALLET_IDS.some((pid) => id.includes(pid)) ||
    recentWallets.includes(connector.id) ||
    connector.ready
  );
}

function sortConnectors(connectors: WalletConnector[], recentWallets: string[]): WalletConnector[] {
  return [...connectors].sort((a, b) => {
    const aRecent = recentWallets.indexOf(a.id);
    const bRecent = recentWallets.indexOf(b.id);
    // Recent wallets first
    if (aRecent !== -1 && bRecent !== -1) return aRecent - bRecent;
    if (aRecent !== -1) return -1;
    if (bRecent !== -1) return 1;
    // Installed next
    if (a.ready && !b.ready) return -1;
    if (!a.ready && b.ready) return 1;
    // Alphabetical
    return a.name.localeCompare(b.name);
  });
}

export function WalletListPanel({
  connectors,
  recentWallets,
  selectedConnectorId,
  onSelect,
  className,
}: WalletListPanelProps) {
  const popular = sortConnectors(
    connectors.filter((c) => isPopular(c, recentWallets)),
    recentWallets
  );
  const more = sortConnectors(
    connectors.filter((c) => !isPopular(c, recentWallets)),
    recentWallets
  );

  return (
    <ScrollArea className={className}>
      <div className="flex flex-col gap-1 p-3">
        {popular.length > 0 && (
          <>
            <p className="text-muted-foreground px-3 py-1.5 text-xs font-medium">Popular</p>
            {popular.map((connector) => (
              <WalletListItem
                key={connector.id}
                name={connector.name}
                icon={connector.icon}
                recent={recentWallets.includes(connector.id)}
                installed={connector.ready}
                selected={connector.id === selectedConnectorId}
                onClick={() => onSelect(connector.id)}
              />
            ))}
          </>
        )}
        {more.length > 0 && (
          <>
            {popular.length > 0 && <Separator className="my-2" />}
            <p className="text-muted-foreground px-3 py-1.5 text-xs font-medium">More</p>
            {more.map((connector) => (
              <WalletListItem
                key={connector.id}
                name={connector.name}
                icon={connector.icon}
                recent={recentWallets.includes(connector.id)}
                installed={connector.ready}
                selected={connector.id === selectedConnectorId}
                onClick={() => onSelect(connector.id)}
              />
            ))}
          </>
        )}
      </div>
    </ScrollArea>
  );
}
