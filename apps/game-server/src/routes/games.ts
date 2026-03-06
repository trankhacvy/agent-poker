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
