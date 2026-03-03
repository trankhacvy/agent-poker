import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

export default async function statsRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get(
    "/stats",
    {
      schema: {
        response: {
          200: Type.Object({
            totalGamesPlayed: Type.Number(),
            totalAgents: Type.Number(),
            activeGames: Type.Number(),
            totalVolume: Type.Number(),
          }),
        },
      },
    },
    async () => {
      return fastify.solanaRead.getStats(
        fastify.gameTracker.activeCount
      );
    }
  );
}
