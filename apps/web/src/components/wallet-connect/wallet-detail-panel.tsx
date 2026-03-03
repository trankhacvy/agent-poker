"use client";

import { Wallet, KeyRound, Download, AlertCircle, ExternalLink, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WalletIcon } from "./wallet-icon";
import { ConnectingAnimation } from "./connecting-animation";
import type { WalletInstallInfo } from "./wallet-install-info";

export type DetailView = "get-wallet" | "connecting" | "error" | "install" | "get-started";

export interface WalletDetailPanelProps {
  view: DetailView;
  walletName?: string;
  walletIcon?: string;
  error?: Error | null;
  installInfo?: WalletInstallInfo;
  onRetry?: () => void;
  onGetStarted?: () => void;
  onBackToInstall?: () => void;
  className?: string;
}

function GetWalletView() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
      <h3 className="text-lg font-semibold">What is a Wallet?</h3>
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
            <Wallet className="size-5" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">A Home for your Digital Assets</p>
            <p className="text-muted-foreground text-xs">
              Wallets are used to send, receive, store, and display digital assets like Solana and
              NFTs.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
            <KeyRound className="size-5" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">A New Way to Log In</p>
            <p className="text-muted-foreground text-xs">
              Instead of creating new accounts and passwords on every website, just connect your
              wallet.
            </p>
          </div>
        </div>
      </div>
      <Button variant="default" className="mt-2" asChild>
        <a href="https://solana.com/solana-wallets" target="_blank" rel="noopener noreferrer">
          Get a Wallet
          <ExternalLink className="ml-2 size-3.5" />
        </a>
      </Button>
    </div>
  );
}

function ConnectingView({ walletName, walletIcon }: { walletName?: string; walletIcon?: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <ConnectingAnimation walletName={walletName} walletIcon={walletIcon} />
    </div>
  );
}

function ErrorView({
  walletName,
  walletIcon,
  error,
  onRetry,
}: {
  walletName?: string;
  walletIcon?: string;
  error?: Error | null;
  onRetry?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="relative">
        {walletIcon ? (
          <WalletIcon name={walletName} icon={walletIcon} size={64} />
        ) : (
          <AlertCircle className="text-destructive size-12" />
        )}
      </div>
      {walletName && <p className="text-sm font-medium">{walletName}</p>}
      <p className="text-destructive max-w-[240px] text-center text-sm">
        {error?.message || "Connection failed. Please try again."}
      </p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try Again
        </Button>
      )}
    </div>
  );
}

function InstallView({
  walletName,
  walletIcon,
  installInfo,
  onGetStarted,
}: {
  walletName?: string;
  walletIcon?: string;
  installInfo?: WalletInstallInfo;
  onGetStarted?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-6">
      <WalletIcon name={walletName} icon={walletIcon} size={64} />
      <div className="text-center">
        <h3 className="text-base font-semibold">Install {walletName ?? "Wallet"}</h3>
        {installInfo?.description && (
          <p className="text-muted-foreground mt-1 max-w-[280px] text-xs">
            {installInfo.description}
          </p>
        )}
      </div>
      {installInfo?.installLinks && installInfo.installLinks.length > 0 && (
        <div className="flex w-full max-w-[240px] flex-col gap-2">
          {installInfo.installLinks.map((link) => (
            <Button
              key={link.label}
              variant="outline"
              size="sm"
              className="w-full justify-between"
              asChild
            >
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                <span className="flex items-center gap-2">
                  <Download className="size-3.5" />
                  {link.label}
                </span>
                <ExternalLink className="size-3" />
              </a>
            </Button>
          ))}
        </div>
      )}
      {installInfo?.gettingStartedSteps && onGetStarted && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground text-xs"
          onClick={onGetStarted}
        >
          Get Started
          <ChevronRight className="ml-1 size-3" />
        </Button>
      )}
    </div>
  );
}

function GetStartedView({
  walletName,
  walletIcon,
  installInfo,
  onBack,
}: {
  walletName?: string;
  walletIcon?: string;
  installInfo?: WalletInstallInfo;
  onBack?: () => void;
}) {
  const steps = installInfo?.gettingStartedSteps ?? [];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-6">
      <WalletIcon name={walletName} icon={walletIcon} size={64} />
      <h3 className="text-base font-semibold">Get Started with {walletName ?? "Wallet"}</h3>
      {steps.length > 0 && (
        <ol className="flex max-w-[280px] flex-col gap-3">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="bg-primary text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                {i + 1}
              </span>
              <span className="text-muted-foreground text-sm">{step}</span>
            </li>
          ))}
        </ol>
      )}
      {onBack && (
        <Button variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
      )}
    </div>
  );
}

export function WalletDetailPanel({
  view,
  walletName,
  walletIcon,
  error,
  installInfo,
  onRetry,
  onGetStarted,
  onBackToInstall,
  className,
}: WalletDetailPanelProps) {
  return (
    <div className={cn("flex h-full flex-col", className)}>
      {view === "get-wallet" && <GetWalletView />}
      {view === "connecting" && <ConnectingView walletName={walletName} walletIcon={walletIcon} />}
      {view === "error" && (
        <ErrorView
          walletName={walletName}
          walletIcon={walletIcon}
          error={error}
          onRetry={onRetry}
        />
      )}
      {view === "install" && (
        <InstallView
          walletName={walletName}
          walletIcon={walletIcon}
          installInfo={installInfo}
          onGetStarted={onGetStarted}
        />
      )}
      {view === "get-started" && (
        <GetStartedView
          walletName={walletName}
          walletIcon={walletIcon}
          installInfo={installInfo}
          onBack={onBackToInstall}
        />
      )}
    </div>
  );
}
