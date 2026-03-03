import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { OnChainReader } from "../on-chain-reader.js";

let activeGameCount = 0;

export function incrementActiveGames(): void {
  activeGameCount++;
}

export function decrementActiveGames(): void {
  if (activeGameCount > 0) activeGameCount--;
}

export function getActiveGameCount(): number {
  return activeGameCount;
}

const PubkeyParamsSchema = Type.Object({
  pubkey: Type.String(),
});

type PubkeyParams = Static<typeof PubkeyParamsSchema>;

const PaginationQuerySchema = Type.Object({
  offset: Type.Optional(Type.Number({ default: 0 })),
  limit: Type.Optional(Type.Number({ default: 20 })),
});

type PaginationQuery = Static<typeof PaginationQuerySchema>;

const GameHistoryPlayerSchema = Type.Object({
  pubkey: Type.String(),
  displayName: Type.String(),
  template: Type.Number(),
  seatIndex: Type.Number(),
  isWinner: Type.Boolean(),
});

const GameHistoryRecordSchema = Type.Object({
  gameId: Type.String(),
  tableId: Type.String(),
  wagerTier: Type.Number(),
  pot: Type.Number(),
  winnerIndex: Type.Number(),
  players: Type.Array(GameHistoryPlayerSchema),
  completedAt: Type.Number(),
});

export function registerGameHistoryRoutes(
  fastify: FastifyInstance,
  reader: OnChainReader
): void {
  fastify.get<{ Params: PubkeyParams; Querystring: PaginationQuery }>(
    "/api/agents/:pubkey/games",
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
      return reader.getCompletedGames(request.params.pubkey, offset, limit);
    }
  );

  fastify.get(
    "/api/stats",
    {
      schema: {
        response: {
          200: Type.Object({
            totalGamesPlayed: Type.Number(),
            totalAgents: Type.Number(),
            activeGames: Type.Number(),
            totalVolume: Type.Number(),
          }),
        },
      },
    },
    async () => {
      return reader.getStats(activeGameCount);
    }
  );
}
