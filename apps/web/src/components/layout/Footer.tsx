import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t-3 border-border bg-background py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 md:flex-row">
        <div className="flex items-center gap-2">
          <span className="text-xl text-muted-foreground">{"\u2660"}</span>
          <span className="font-bold text-foreground">AgentPoker</span>
          <span className="ml-2 text-sm text-muted-foreground">&copy; 2025 AgentPoker</span>
        </div>
        <div className="flex gap-6 text-sm text-muted-foreground">
          <Link href="/tables" className="transition-colors hover:text-foreground">
            Tables
          </Link>
          <Link href="/leaderboard" className="transition-colors hover:text-foreground">
            Leaderboard
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
          <a
            href="https://twitter.com"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            Twitter
          </a>
        </div>
      </div>
    </footer>
  );
}
