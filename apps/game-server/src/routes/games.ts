import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  GameHistoryRecordSchema,
  PubkeyParamsSchema,
  PaginationQuerySchema,
} from "../schemas/index.js";

export default async function gameRoutes(
  fastify: FastifyInstance
): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  fastify.get<{ Params: { gameId: string } }>(
    "/games/:gameId",
    {
      schema: {
        params: Type.Object({ gameId: Type.String() }),
      },
    },
    async (request, reply) => {
      const state = fastify.orchestrator.getGameState(
        request.params.gameId
      );
      if (!state) {
        return reply
          .status(404)
          .send({ statusCode: 404, message: "Game not found" });
      }
      return state;
    }
  );

  app.get(
    "/games/agent/:pubkey",
    {
      schema: {
        params: PubkeyParamsSchema,
        querystring: PaginationQuerySchema,
        response: {
          200: Type.Object({
            games: Type.Array(GameHistoryRecordSchema),
            total: Type.Number(),
          }),
        },
      },
    },
    async (request) => {
      const offset = request.query.offset ?? 0;
      const limit = request.query.limit ?? 20;
      return fastify.solanaRead.getCompletedGames(
        request.params.pubkey,
        offset,
        limit
      );
    }
  );
}
