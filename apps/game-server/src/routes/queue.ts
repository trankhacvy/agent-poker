import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { JoinBodySchema } from "../schemas/index.js";

export default async function queueRoutes(
  fastify: FastifyInstance
): Promise<void> {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();

  app.post(
    "/queue/join",
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
      const { pubkey, displayName, template, wagerTier } =
        request.body;
      fastify.matchmaker.joinQueue(
        { pubkey, displayName, template, seatIndex: 0 },
        wagerTier
      );
      return {
        message: "Joined queue",
        queueSize: fastify.matchmaker.getQueueSize(wagerTier),
        wagerTier,
      };
    }
  );
}
