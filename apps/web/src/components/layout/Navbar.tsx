"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { ConnectButton } from "@/components/wallet-connect/connect-button";

const navLinks = [
  { href: "/", label: "Live Arena" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/agents", label: "Create Agent" },
  { href: "/tables", label: "Tables" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed top-0 left-0 z-50 w-full border-b border-neutral-500 bg-neutral-700/90 backdrop-blur-sm">
      <div className="flex items-center h-16 px-3 sm:h-[4.75rem] sm:px-5 lg:h-[5.25rem] lg:px-7.5 xl:px-10 max-w-[77.5rem] mx-auto">
        {/* Logo */}
        <Link href="/" className="block xl:mr-8">
          <span className="flex items-center gap-1.5 sm:gap-2">
            <Image src="/icon.png" alt="logo" width={48} height={48} className="w-8 h-8 sm:w-12 sm:h-12" />
            <span className="text-xl sm:text-3xl font-bold font-grotesk">AgentPoker</span>
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden lg:flex lg:mx-auto">
          <div className="flex flex-row">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "block relative font-semibold transition-colors",
                    "lg:-mr-0.25 lg:text-xs lg:font-semibold lg:leading-5 lg:uppercase lg:tracking-wider",
                    "px-6 py-8",
                    isActive ? "text-neutral-50" : "text-neutral-300 hover:text-neutral-50"
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Live Devnet badge */}
        <div className="hidden lg:flex items-center gap-2 rounded-lg border border-neutral-50/10 bg-neutral-50/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-violet shrink-0 mr-4">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-violet" />
          </span>
          Live Devnet
        </div>

        {/* Wallet button (desktop) */}
        <div className="shrink-0 hidden sm:block">
          <ConnectButton showCluster={false} />
        </div>

        {/* Mobile menu (Sheet) */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              className="ml-auto lg:hidden relative w-10 h-10 flex items-center justify-center rounded-xl hover:bg-neutral-500/50 transition-colors"
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="flex flex-col gap-0 px-0 pt-12 pb-8">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <nav className="flex flex-col">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "block px-6 py-4 text-lg font-semibold transition-colors border-b border-neutral-50/5",
                      isActive
                        ? "text-neutral-50 bg-violet/10"
                        : "text-neutral-300 hover:text-neutral-50 hover:bg-neutral-500/30"
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto px-6">
              <ConnectButton showCluster={false} className="w-full" />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
