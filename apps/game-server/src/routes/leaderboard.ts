import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { OnChainReader } from "../on-chain-reader.js";

const LeaderboardEntrySchema = Type.Object({
  pubkey: Type.String(),
  owner: Type.String(),
  displayName: Type.String(),
  template: Type.Number(),
  vault: Type.String(),
  balance: Type.Number(),
  gamesPlayed: Type.Number(),
  wins: Type.Number(),
  earnings: Type.Number(),
  createdAt: Type.Number(),
});

export function registerLeaderboardRoutes(
  fastify: FastifyInstance,
  reader: OnChainReader
): void {
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
      const leaderboard = await reader.getLeaderboard();
      return { leaderboard };
    }
  );
}
