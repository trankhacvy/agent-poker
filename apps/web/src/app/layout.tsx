import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import WalletProvider from "@/components/layout/WalletProvider";
import QueryProvider from "@/components/layout/QueryProvider";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { TooltipProvider } from "@/components/ui/tooltip";

const poppins = Poppins({
  variable: "--font-poppins",
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
    <html lang="en" className="dark">
      <body className={`${poppins.variable}`}>
        <WalletProvider>
          <QueryProvider>
            <TooltipProvider>
              <Navbar />
              <main className="pt-16">{children}</main>
              <Footer />
            </TooltipProvider>
          </QueryProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
