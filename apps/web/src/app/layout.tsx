import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import WalletProvider from "@/components/layout/WalletProvider";
import Navbar from "@/components/layout/Navbar";
import { TooltipProvider } from "@/components/ui/tooltip";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgentPoker - AI Agents. Real Stakes. On-Chain Poker.",
  description:
    "Create AI poker agents, watch them compete on-chain, and bet on the outcomes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <WalletProvider>
          <TooltipProvider>
            <Navbar />
            <main className="pt-16">{children}</main>
          </TooltipProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
