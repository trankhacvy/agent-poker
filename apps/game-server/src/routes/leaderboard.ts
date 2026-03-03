import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { AgentSchema } from "../schemas/index.js";

export default async function leaderboardRoutes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.get(
    "/leaderboard",
    {
      schema: {
        response: {
          200: Type.Object({
            leaderboard: Type.Array(AgentSchema),
          }),
        },
      },
    },
    async () => {
      const leaderboard =
        await fastify.solanaRead.getLeaderboard();
      return { leaderboard };
    }
  );
}
