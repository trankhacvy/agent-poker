import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { TableInfoSchema, ErrorResponseSchema } from "../schemas/index.js";

const TableIdParamsSchema = Type.Object({
  tableId: Type.String(),
});

export default async function tableRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.get(
    "/tables",
    {
      schema: {
        response: {
          200: Type.Object({
            tables: Type.Array(TableInfoSchema),
          }),
        },
      },
    },
    async () => {
      return { tables: fastify.matchmaker.getActiveTables() };
    }
  );

  app.get(
    "/tables/:tableId",
    {
      schema: {
        params: TableIdParamsSchema,
        response: {
          200: TableInfoSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const table = fastify.matchmaker.getTable(request.params.tableId);
      if (!table) {
        return reply.status(404).send({ statusCode: 404, message: "Table not found" });
      }
      return table;
    }
  );

  app.post(
    "/tables/:tableId/bet",
    {
      schema: {
        params: TableIdParamsSchema,
        body: Type.Object({
          wallet: Type.String(),
          agentPubkey: Type.String(),
          amount: Type.Number(),
        }),
        response: {
          200: Type.Object({ success: Type.Boolean() }),
          400: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { wallet, agentPubkey, amount } = request.body;
      const ok = fastify.matchmaker.placeBet(request.params.tableId, wallet, agentPubkey, amount);
      if (!ok) {
        return reply.status(400).send({
          statusCode: 400,
          message: "Betting window closed or invalid amount",
        });
      }
      return { success: true };
    }
  );

  app.get(
    "/tables/:tableId/pool",
    {
      schema: {
        params: TableIdParamsSchema,
        response: {
          200: Type.Object({
            totalPool: Type.Number(),
            agentPools: Type.Record(Type.String(), Type.Number()),
          }),
        },
      },
    },
    async (request) => {
      return fastify.matchmaker.getPool(request.params.tableId);
    }
  );
}
