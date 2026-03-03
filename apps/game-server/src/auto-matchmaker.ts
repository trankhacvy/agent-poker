import type { Matchmaker } from "./matchmaker.js";
import type { OnChainReader } from "./on-chain-reader.js";

const MAX_PLAYERS = 2;
const LOWEST_WAGER_TIER = 0.1e9; // $1 tier — 0.1 SOL in lamports

interface AutoMatchmakerOpts {
  intervalMs: number;
  enabled: boolean;
}

export class AutoMatchmaker {
  private matchmaker: Matchmaker;
  private reader: OnChainReader;
  private intervalMs: number;
  private enabled: boolean;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    matchmaker: Matchmaker,
    reader: OnChainReader,
    opts: AutoMatchmakerOpts
  ) {
    this.matchmaker = matchmaker;
    this.reader = reader;
    this.intervalMs = opts.intervalMs;
    this.enabled = opts.enabled;
  }

  start(): void {
    if (!this.enabled) {
      console.log("[AutoMatchmaker] Disabled via config, not starting");
      return;
    }

    console.log(
      `[AutoMatchmaker] Started — interval ${this.intervalMs}ms`
    );

    // Run once immediately, then on interval
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[AutoMatchmaker] Stopped");
    }
  }

  private async tick(): Promise<void> {
    try {
      // Check if there's already an active game (in_progress or full)
      const tables = this.matchmaker.getActiveTables();
      const hasActiveGame = tables.some(
        (t) => t.status === "in_progress" || t.status === "full"
      );

      if (hasActiveGame) {
        console.log("[AutoMatchmaker] Skipping — active game already running");
        return;
      }

      // Fetch on-chain agents
      const { agents } = await this.reader.getAllAgents(0, 100);

      if (agents.length < MAX_PLAYERS) {
        console.log(
          `[AutoMatchmaker] Skipping — only ${agents.length} agents registered (need ${MAX_PLAYERS})`
        );
        return;
      }

      // Shuffle and pick MAX_PLAYERS agents
      const shuffled = [...agents].sort(() => Math.random() - 0.5);
      const picked = shuffled.slice(0, MAX_PLAYERS);

      console.log(
        `[AutoMatchmaker] Queuing ${picked.length} agents: ${picked.map((a) => a.displayName).join(", ")}`
      );

      for (const agent of picked) {
        this.matchmaker.joinQueue(
          {
            pubkey: agent.pubkey,
            displayName: agent.displayName,
            template: agent.template,
            seatIndex: 0,
          },
          LOWEST_WAGER_TIER
        );
      }
    } catch (err) {
      console.error("[AutoMatchmaker] Tick failed, will retry next interval:", err);
    }
  }
}
