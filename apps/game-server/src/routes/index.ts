import type { FastifyInstance } from "fastify";
import agentRoutes from "./agents.js";
import gameRoutes from "./games.js";
import leaderboardRoutes from "./leaderboard.js";
import queueRoutes from "./queue.js";
import tableRoutes from "./tables.js";
import statsRoutes from "./stats.js";
import arenaRoutes from "./arena.js";

export default async function routes(
  fastify: FastifyInstance
): Promise<void> {
  fastify.register(agentRoutes, { prefix: "/api" });
  fastify.register(gameRoutes, { prefix: "/api" });
  fastify.register(leaderboardRoutes, { prefix: "/api" });
  fastify.register(queueRoutes, { prefix: "/api" });
  fastify.register(tableRoutes, { prefix: "/api" });
  fastify.register(statsRoutes, { prefix: "/api" });
  fastify.register(arenaRoutes, { prefix: "/api" });
}
