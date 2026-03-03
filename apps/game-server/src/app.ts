import Fastify, { type FastifyInstance } from "fastify";
import plugins from "./plugins/index.js";
import routes from "./routes/index.js";

export async function buildApp(
  opts: { logger?: boolean } = {}
): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: opts.logger ?? true });

  fastify.get("/health", async () => ({ status: "ok" }));

  await fastify.register(plugins);
  await fastify.register(routes);

  return fastify;
}
