import type { FastifyInstance } from "fastify";

export default async function arenaRoutes(fastify: FastifyInstance) {
  // GET /api/arena/status - Current arena state
  fastify.get("/arena/status", async () => {
    return fastify.arenaManager.getStatus();
  });

  // GET /api/arena/agents - The 6 system agents
  fastify.get("/arena/agents", async () => {
    return { agents: fastify.arenaManager.getStatus().agents };
  });
}
