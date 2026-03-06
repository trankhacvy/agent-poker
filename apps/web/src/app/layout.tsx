import type { Metadata } from "next";
import { Poppins, Space_Grotesk, Sora } from "next/font/google";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import WalletProvider from "@/components/layout/WalletProvider";
import QueryProvider from "@/components/layout/QueryProvider";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

const poppins = Poppins({
  variable: "--font-poppins",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

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
        <WalletProvider>
          <QueryProvider>
            <TooltipProvider>
              <Navbar />
              <main className="pt-24">{children}</main>
              <Footer />
            </TooltipProvider>
          </QueryProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
