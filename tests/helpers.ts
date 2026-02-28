import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const FUND_AMOUNT = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL per keypair

/**
 * Fund a single keypair by transferring SOL from the provider wallet.
 * Use this instead of requestAirdrop to avoid devnet rate limits.
 */
export async function fundKeypair(
  provider: anchor.AnchorProvider,
  keypair: Keypair,
  amount: number = FUND_AMOUNT
): Promise<void> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: keypair.publicKey,
      lamports: amount,
    })
  );
  await provider.sendAndConfirm(tx);
}

/**
 * Fund multiple keypairs in batched transactions.
 * Each batch contains up to 10 transfers to stay within tx size limits.
 */
export async function fundKeypairs(
  provider: anchor.AnchorProvider,
  keypairs: Keypair[],
  amount: number = FUND_AMOUNT
): Promise<void> {
  const BATCH_SIZE = 10;
  for (let i = 0; i < keypairs.length; i += BATCH_SIZE) {
    const batch = keypairs.slice(i, i + BATCH_SIZE);
    const tx = new Transaction();
    for (const kp of batch) {
      tx.add(
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: kp.publicKey,
          lamports: amount,
        })
      );
    }
    await provider.sendAndConfirm(tx);
  }
}
