import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

interface AgentRecord {
  pubkey: string;
  displayName: string;
  template: number;
  gamesPlayed: number;
  wins: number;
}

const agentStore: Map<string, AgentRecord> = new Map();

const AgentSchema = Type.Object({
  pubkey: Type.String(),
  displayName: Type.String(),
  template: Type.Number(),
  gamesPlayed: Type.Number(),
  wins: Type.Number(),
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

export function registerAgentRoutes(fastify: FastifyInstance): void {
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
      const agent = agentStore.get(request.params.pubkey);
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
      const allAgents = Array.from(agentStore.values());
      const paginated = allAgents.slice(offset, offset + limit);
      return { agents: paginated, total: allAgents.length };
    }
  );
}

export function recordAgentGame(
  pubkey: string,
  displayName: string,
  template: number,
  won: boolean
): void {
  let agent = agentStore.get(pubkey);
  if (!agent) {
    agent = { pubkey, displayName, template, gamesPlayed: 0, wins: 0 };
    agentStore.set(pubkey, agent);
  }
  agent.gamesPlayed++;
  if (won) {
    agent.wins++;
  }
}
