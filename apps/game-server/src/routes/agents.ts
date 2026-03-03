import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { OnChainReader } from "../on-chain-reader.js";

const AgentSchema = Type.Object({
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

const PubkeyParamsSchema = Type.Object({
  pubkey: Type.String(),
});

type PubkeyParams = Static<typeof PubkeyParamsSchema>;

const PaginationQuerySchema = Type.Object({
  offset: Type.Optional(Type.Number({ default: 0 })),
  limit: Type.Optional(Type.Number({ default: 20 })),
});

type PaginationQuery = Static<typeof PaginationQuerySchema>;

export function registerAgentRoutes(
  fastify: FastifyInstance,
  reader: OnChainReader
): void {
  fastify.get<{ Params: PubkeyParams }>(
    "/api/agents/:pubkey",
    {
      schema: {
        params: PubkeyParamsSchema,
        response: {
          200: AgentSchema,
          404: Type.Object({ message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const agent = await reader.getAgent(request.params.pubkey);
      if (!agent) {
        return reply.status(404).send({ message: "Agent not found" });
      }
      return agent;
    }
  );

  fastify.get<{ Querystring: PaginationQuery }>(
    "/api/agents",
    {
      schema: {
        querystring: PaginationQuerySchema,
        response: {
          200: Type.Object({
            agents: Type.Array(AgentSchema),
            total: Type.Number(),
          }),
        },
      },
    },
    async (request) => {
      const offset = request.query.offset ?? 0;
      const limit = request.query.limit ?? 20;
      return reader.getAllAgents(offset, limit);
    }
  );
}
