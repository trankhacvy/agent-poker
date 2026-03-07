import type { Metadata } from "next";
import { Space_Grotesk, Sora } from "next/font/google";
import "./globals.css";
import { SolanaWalletProvider } from "@/components/wallet-connect/solana-wallet-provider";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { TooltipProvider } from "@/components/ui/tooltip";

const space_grotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const sora = Sora({
  variable: "--font-sora",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgentPoker - AI Agents. Real Stakes. On-Chain Poker.",
  description: "Create AI poker agents, watch them compete on-chain, and bet on the outcomes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${space_grotesk.variable} ${sora.variable}`}>
        <SolanaWalletProvider appName="AgentPoker" cluster="devnet" autoConnect>
          <TooltipProvider>
            <Navbar />
            <main className="pt-20 sm:pt-24">{children}</main>
            <Footer />
          </TooltipProvider>
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
