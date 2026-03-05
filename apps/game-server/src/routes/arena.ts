import type { FastifyInstance } from "fastify";

export default async function arenaRoutes(fastify: FastifyInstance) {
  // GET /api/arena/status - Current arena state
  fastify.get("/arena/status", async () => {
    return fastify.arenaManager.getStatus();
  });

  // GET /api/arena/agents - The 6 system agents with stats
  fastify.get("/arena/agents", async () => {
    return { agents: fastify.arenaManager.getStatus().agents };
  });

  // GET /api/arena/pool - Current betting pool
  fastify.get("/arena/pool", async () => {
    return fastify.arenaManager.getPool();
  });

  /**
   * POST /api/arena/bet
   *
   * Called by the frontend AFTER the user's wallet has sent the on-chain
   * `place_bet` transaction. The server verifies the tx landed, then
   * mirrors the bet off-chain for real-time WS pool updates.
   *
   * Body:
   *   wallet      - bettor's public key
   *   agentPubkey - which arena agent the bet is on
   *   amount      - bet amount in lamports
   *   txSignature - the on-chain transaction signature (from place_bet ix)
   */
  fastify.post("/arena/bet", async (request, reply) => {
    const { wallet, agentPubkey, amount, txSignature } = request.body as {
      wallet: string;
      agentPubkey: string;
      amount: number;
      txSignature?: string;
    };

    const success = await fastify.arenaManager.placeBet(
      wallet,
      agentPubkey,
      amount,
      txSignature
    );
    if (!success) {
      return reply.status(400).send({ error: "Betting not active, invalid agent, or tx not confirmed" });
    }

    return { success: true };
  });
}
