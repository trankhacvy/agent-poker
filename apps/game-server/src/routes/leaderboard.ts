import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

interface LeaderboardEntry {
  pubkey: string;
  displayName: string;
  template: number;
  wins: number;
  gamesPlayed: number;
}

const leaderboardStore: Map<string, LeaderboardEntry> = new Map();

const LeaderboardEntrySchema = Type.Object({
  pubkey: Type.String(),
  displayName: Type.String(),
  template: Type.Number(),
  wins: Type.Number(),
  gamesPlayed: Type.Number(),
});

export function registerLeaderboardRoutes(fastify: FastifyInstance): void {
  fastify.get(
    "/api/leaderboard",
    {
      schema: {
        response: {
          200: Type.Object({
            leaderboard: Type.Array(LeaderboardEntrySchema),
          }),
        },
      },
    },
    async () => {
      const entries = Array.from(leaderboardStore.values())
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 100);
      return { leaderboard: entries };
    }
  );
}

export function updateLeaderboard(
  pubkey: string,
  displayName: string,
  template: number,
  won: boolean
): void {
  let entry = leaderboardStore.get(pubkey);
  if (!entry) {
    entry = { pubkey, displayName, template, wins: 0, gamesPlayed: 0 };
    leaderboardStore.set(pubkey, entry);
  }
  entry.gamesPlayed++;
  if (won) {
    entry.wins++;
  }
}
