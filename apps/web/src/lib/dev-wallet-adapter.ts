import {
  BaseSignerWalletAdapter,
  WalletName,
  WalletReadyState,
  type SupportedTransactionVersions,
} from "@solana/wallet-adapter-base";
import type { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

const DEV_WALLET_ICON =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="#222"/><text x="16" y="21" text-anchor="middle" font-size="14" fill="#0f0" font-family="monospace">D</text></svg>'
  );

export class DevWalletAdapter extends BaseSignerWalletAdapter<"Dev Wallet"> {
  name = "Dev Wallet" as WalletName<"Dev Wallet">;
  url = "https://localhost";
  icon = DEV_WALLET_ICON;
  readyState = WalletReadyState.Installed;
  supportedTransactionVersions: SupportedTransactionVersions = null;
  publicKey: PublicKey | null = null;
  connecting = false;

  private _keypair: Keypair;

  constructor(keypair: Keypair) {
    super();
    this._keypair = keypair;
  }

  async connect(): Promise<void> {
    this.connecting = true;
    try {
      this.publicKey = this._keypair.publicKey;
      this.emit("connect", this.publicKey);
    } finally {
      this.connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this.publicKey = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T
  ): Promise<T> {
    if ("version" in transaction) {
      (transaction as VersionedTransaction).sign([this._keypair]);
    } else {
      (transaction as Transaction).sign(this._keypair);
    }
    return transaction;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[]
  ): Promise<T[]> {
    for (const tx of transactions) {
      await this.signTransaction(tx);
    }
    return transactions;
  }
}
