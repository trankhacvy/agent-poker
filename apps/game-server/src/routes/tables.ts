import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { Matchmaker } from "../matchmaker.js";

const PlayerInfoSchema = Type.Object({
  pubkey: Type.String(),
  displayName: Type.String(),
  template: Type.Number(),
  seatIndex: Type.Number(),
});

const JoinBodySchema = Type.Object({
  pubkey: Type.String(),
  displayName: Type.String(),
  template: Type.Number(),
  wagerTier: Type.Number(),
});

type JoinBody = Static<typeof JoinBodySchema>;

const TableIdParamsSchema = Type.Object({
  tableId: Type.String(),
});

type TableIdParams = Static<typeof TableIdParamsSchema>;

const TableInfoSchema = Type.Object({
  tableId: Type.String(),
  wagerTier: Type.Number(),
  playerCount: Type.Number(),
  maxPlayers: Type.Number(),
  status: Type.Union([
    Type.Literal("open"),
    Type.Literal("full"),
    Type.Literal("in_progress"),
    Type.Literal("settled"),
  ]),
  players: Type.Array(PlayerInfoSchema),
});

export function registerTableRoutes(
  fastify: FastifyInstance,
  matchmaker: Matchmaker
): void {
  fastify.get(
    "/api/tables",
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
      return { tables: matchmaker.getActiveTables() };
    }
  );

  fastify.get<{ Params: TableIdParams }>(
    "/api/tables/:tableId",
    {
      schema: {
        params: TableIdParamsSchema,
        response: {
          200: TableInfoSchema,
          404: Type.Object({ message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const table = matchmaker.getTable(request.params.tableId);
      if (!table) {
        return reply.status(404).send({ message: "Table not found" });
      }
      return table;
    }
  );

  fastify.post<{ Params: TableIdParams; Body: JoinBody }>(
    "/api/tables/:tableId/join",
    {
      schema: {
        params: TableIdParamsSchema,
        body: JoinBodySchema,
        response: {
          200: Type.Object({
            message: Type.String(),
            queueSize: Type.Number(),
          }),
        },
      },
    },
    async (request) => {
      const { pubkey, displayName, template, wagerTier } = request.body;
      matchmaker.joinQueue(
        { pubkey, displayName, template, seatIndex: 0 },
        wagerTier
      );
      return {
        message: "Joined queue",
        queueSize: matchmaker.getQueueSize(wagerTier),
      };
    }
  );

  fastify.post<{ Body: JoinBody }>(
    "/api/tables/auto/join",
    {
      schema: {
        body: JoinBodySchema,
        response: {
          200: Type.Object({
            message: Type.String(),
            queueSize: Type.Number(),
            wagerTier: Type.Number(),
          }),
        },
      },
    },
    async (request) => {
      const { pubkey, displayName, template, wagerTier } = request.body;
      matchmaker.joinQueue(
        { pubkey, displayName, template, seatIndex: 0 },
        wagerTier
      );
      return {
        message: "Joined queue",
        queueSize: matchmaker.getQueueSize(wagerTier),
        wagerTier,
      };
    }
  );
}
