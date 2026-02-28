"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton
    ),
  { ssr: false }
);

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/tables", label: "Tables" },
  { href: "/agents", label: "My Agents" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-emerald-900/30">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl">♠</span>
          <span className="text-xl font-bold text-emerald-400">
            AgentPoker
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
            >
              <Button variant={pathname === link.href ? "default" : "ghost"}
                className={cn(
                  "font-mono font-bold uppercase",
                  pathname === link.href &&
                    "border-4 border-foreground shadow-xs"
                )}>
                {link.label}
              </Button>
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <WalletMultiButton
            style={{
              backgroundColor: "#059669",
              height: "40px",
              borderRadius: "8px",
              fontSize: "14px",
            }}
          />

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden text-zinc-400">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64 bg-zinc-950 border-zinc-800">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="flex flex-col gap-1 pt-8">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      pathname === link.href
                        ? "bg-emerald-900/40 text-emerald-300"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
