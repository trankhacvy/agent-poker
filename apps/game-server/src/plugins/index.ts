import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";

import envPlugin from "./env.js";
import errorHandlerPlugin from "./error-handler.js";
import gameTrackerPlugin from "./game-tracker.js";
import solanaReadPlugin from "./solana-read.js";
import solanaWritePlugin from "./solana-write.js";
import llmPlugin from "./llm.js";
import websocketFeedPlugin from "./websocket-feed.js";
import matchmakerPlugin from "./matchmaker.js";
import orchestratorPlugin from "./orchestrator.js";
import autoQueuePlugin from "./auto-queue.js";
import gameLifecyclePlugin from "./game-lifecycle.js";

export default fp(
  async (fastify: FastifyInstance) => {
    // Core Fastify plugins
    await fastify.register(fastifyCors, { origin: true });
    await fastify.register(fastifyWebsocket);

    // Env + error handling (no dependencies)
    await fastify.register(envPlugin);
    await fastify.register(errorHandlerPlugin);
    await fastify.register(gameTrackerPlugin);

    // Service plugins (depend on env)
    await fastify.register(solanaReadPlugin);
    await fastify.register(solanaWritePlugin);
    await fastify.register(llmPlugin);

    // WebSocket feed (no dependencies beyond websocket)
    await fastify.register(websocketFeedPlugin);

    // Higher-level services (depend on lower-level ones)
    await fastify.register(matchmakerPlugin);
    await fastify.register(orchestratorPlugin);
    await fastify.register(autoQueuePlugin);

    // Event wiring (depends on all services)
    await fastify.register(gameLifecyclePlugin);
  },
  { name: "plugins" }
);
