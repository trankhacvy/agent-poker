"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false }
);

const navLinks = [
  { href: "/", label: "Live Arena" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/agents", label: "Create Agent" },
  { href: "/tables", label: "Tables" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [openNavigation, setOpenNavigation] = useState(false);

  const toggleNavigation = () => setOpenNavigation((prev) => !prev);
  const handleClick = () => setOpenNavigation(false);

  return (
    <div
      className={cn(
        "fixed top-0 left-0 z-50 w-full border-b border-neutral-500",
        "bg-neutral-700/90 backdrop-blur-sm",
        openNavigation && "bg-neutral-700"
      )}
    >
      <div className="flex items-center h-[4.75rem] px-5 lg:h-[5.25rem] lg:px-7.5 xl:px-10 max-w-[77.5rem] mx-auto">
        {/* Logo */}
        <Link href="/" className="block xl:mr-8" onClick={handleClick}>
          <span className="flex items-center gap-2">
            <span className="text-2xl">{"\u2660"}</span>
            <span
              className="text-xl font-bold bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(to right, #AC6AFF, #FF98E2, #FFC876)" }}
            >
              AgentPoker
            </span>
          </span>
        </Link>

        {/* Navigation */}
        <nav
          className={cn(
            "fixed top-[4.75rem] left-0 right-0 bottom-0 bg-neutral-700",
            "lg:static lg:flex lg:mx-auto lg:bg-transparent",
            openNavigation ? "flex" : "hidden"
          )}
        >
          <div className="relative z-2 flex flex-col items-center justify-center m-auto lg:flex-row">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={handleClick}
                  className={cn(
                    "block relative font-semibold text-2xl transition-colors",
                    "px-6 py-6 md:py-8",
                    "lg:-mr-0.25 lg:text-xs lg:font-semibold lg:leading-5 lg:uppercase lg:tracking-wider xl:px-12",
                    isActive
                      ? "text-neutral-50"
                      : "text-neutral-300 hover:text-neutral-50"
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* Mobile menu background decorations */}
          <div className="absolute inset-0 pointer-events-none lg:hidden">
            <div className="absolute top-0 left-5 w-px h-full bg-neutral-500" />
            <div className="absolute top-0 right-5 w-px h-full bg-neutral-500" />
            <div className="absolute top-[4.4rem] left-16 w-3 h-3 bg-gradient-to-b from-coral to-neutral-700 rounded-full" />
            <div className="absolute top-[12.6rem] right-16 w-3 h-3 bg-gradient-to-b from-neutral-200 to-neutral-700 rounded-full" />
            <div className="absolute top-[26.8rem] left-12 w-6 h-6 bg-gradient-to-b from-green to-neutral-700 rounded-full" />
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

        {/* Wallet button */}
        <div className="hidden lg:block shrink-0">
          <WalletMultiButton
            style={{
              backgroundColor: "rgba(172, 106, 255, 0.15)",
              height: "44px",
              minWidth: "160px",
              borderRadius: "12px",
              fontSize: "12px",
              fontWeight: "600",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              border: "1px solid rgba(172, 106, 255, 0.3)",
              color: "#AC6AFF",
              whiteSpace: "nowrap",
            }}
          />
        </div>

        {/* Hamburger toggle */}
        <button
          className="ml-auto lg:hidden relative w-10 h-10 flex items-center justify-center rounded-xl hover:bg-neutral-500/50 transition-colors"
          onClick={toggleNavigation}
          aria-label={openNavigation ? "Close menu" : "Open menu"}
        >
          <svg className="overflow-visible" width="20" height="12" viewBox="0 0 20 12">
            <rect
              className="transition-all origin-center"
              y={openNavigation ? "5" : "0"}
              width="20"
              height="2"
              rx="1"
              fill="white"
              transform={openNavigation ? "rotate(45)" : "rotate(0)"}
            />
            <rect
              className="transition-all origin-center"
              y={openNavigation ? "5" : "10"}
              width="20"
              height="2"
              rx="1"
              fill="white"
              transform={openNavigation ? "rotate(-45)" : "rotate(0)"}
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
