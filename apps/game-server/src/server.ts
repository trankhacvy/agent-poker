import "dotenv/config";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import { SolanaClient } from "./solana-client.js";
import { LlmGateway, type LlmProvider } from "./llm-gateway.js";
import { Orchestrator } from "./orchestrator.js";
import { Matchmaker } from "./matchmaker.js";
import { WsFeed } from "./ws-feed.js";
import { registerTableRoutes } from "./routes/tables.js";
import { registerAgentRoutes, recordAgentGame } from "./routes/agents.js";
import { registerLeaderboardRoutes, updateLeaderboard } from "./routes/leaderboard.js";

const PORT = parseInt(process.env.GAME_SERVER_PORT ?? "3001", 10);
const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? "gemini") as LlmProvider;
const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const AUTHORITY_KEYPAIR_PATH =
  process.env.AUTHORITY_KEYPAIR_PATH ?? "~/.config/solana/id.json";
const EPHEMERAL_PROVIDER_ENDPOINT =
  process.env.EPHEMERAL_PROVIDER_ENDPOINT ?? "https://devnet.magicblock.app/";
const EPHEMERAL_WS_ENDPOINT =
  process.env.EPHEMERAL_WS_ENDPOINT ?? "wss://devnet.magicblock.app/";

const fastify = Fastify({ logger: true });

const solanaClient = new SolanaClient(
  SOLANA_RPC_URL,
  AUTHORITY_KEYPAIR_PATH,
  EPHEMERAL_PROVIDER_ENDPOINT,
  EPHEMERAL_WS_ENDPOINT
);
const llmGateway = new LlmGateway({
  provider: LLM_PROVIDER,
  googleApiKey: GOOGLE_API_KEY,
  openrouterApiKey: OPENROUTER_API_KEY,
});
const wsFeed = new WsFeed();
const matchmaker = new Matchmaker(wsFeed);
const orchestrator = new Orchestrator(solanaClient, llmGateway, wsFeed);

async function start(): Promise<void> {
  await fastify.register(fastifyCors, { origin: true });
  await fastify.register(fastifyWebsocket);

  wsFeed.registerRoutes(fastify);

  registerTableRoutes(fastify, matchmaker);
  registerAgentRoutes(fastify);
  registerLeaderboardRoutes(fastify);

  fastify.get<{ Params: { gameId: string } }>(
    "/api/games/:gameId",
    async (request, reply) => {
      const state = orchestrator.getGameState(request.params.gameId);
      if (!state) {
        return reply.status(404).send({ message: "Game not found" });
      }
      return state;
    }
  );

  matchmaker.on("bettingLocked", (config) => {
    const gameId = Date.now().toString();
    const gameConfig = {
      gameId,
      tableId: config.tableId,
      wagerTier: config.wagerTier,
      players: config.players,
    };

    matchmaker.updateTableStatus(config.tableId, "in_progress");

    orchestrator
      .runGame(gameConfig)
      .then((winnerIndex) => {
        matchmaker.updateTableStatus(config.tableId, "settled");
        for (const player of config.players) {
          const won = player.seatIndex === winnerIndex;
          recordAgentGame(player.pubkey, player.displayName, player.template, won);
          updateLeaderboard(player.pubkey, player.displayName, player.template, won);
        }
      })
      .catch((err: Error) => {
        fastify.log.error(err, "Game failed");
        matchmaker.updateTableStatus(config.tableId, "settled");
      });
  });

  matchmaker.on("queueTimeout", (config) => {
    fastify.log.info(
      { wagerTier: config.wagerTier, count: config.refundedPlayers.length },
      "Queue timeout — refund handled off-chain for localnet"
    );
  });

  await fastify.listen({ port: PORT, host: "0.0.0.0" });
}

start().catch((err: Error) => {
  fastify.log.error(err);
  process.exit(1);
});

export type AppInstance = typeof fastify;
