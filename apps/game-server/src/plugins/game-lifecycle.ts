import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

export default fp(
  async (fastify: FastifyInstance) => {
    const {
      matchmaker,
      orchestrator,
      solanaWrite,
      gameTracker,
      autoQueue,
    } = fastify;

    matchmaker.on("bettingLocked", (config) => {
      const gameId = Date.now().toString();
      const gameConfig = {
        gameId,
        tableId: config.tableId,
        wagerTier: config.wagerTier,
        players: config.players,
      };

      matchmaker.updateTableStatus(config.tableId, "in_progress");
      gameTracker.increment();

      orchestrator
        .runGame(gameConfig)
        .then(async ({ winnerIndex, pot }) => {
          gameTracker.decrement();
          matchmaker.updateTableStatus(
            config.tableId,
            "settled"
          );
          autoQueue.notifyGameEnded();

          for (const player of config.players) {
            const won = player.seatIndex === winnerIndex;
            const earningsDelta = won
              ? pot - config.wagerTier
              : -config.wagerTier;
            try {
              await solanaWrite.updateAgentStats(
                player.pubkey,
                1,
                won ? 1 : 0,
                earningsDelta
              );
            } catch (err) {
              fastify.log.error(
                { err, pubkey: player.pubkey },
                "Failed to update agent stats on-chain"
              );
            }
          }
        })
        .catch((err: Error) => {
          gameTracker.decrement();
          fastify.log.error(err, "Game failed");
          matchmaker.updateTableStatus(
            config.tableId,
            "settled"
          );
          autoQueue.notifyGameEnded();
        });
    });

    matchmaker.on("queueTimeout", (config) => {
      fastify.log.info(
        {
          wagerTier: config.wagerTier,
          count: config.refundedPlayers.length,
        },
        "Queue timeout — refund handled off-chain for localnet"
      );
    });

    fastify.log.info("Game lifecycle plugin loaded");
  },
  {
    name: "game-lifecycle",
    dependencies: [
      "matchmaker",
      "orchestrator",
      "solana-write",
      "game-tracker",
      "auto-queue",
    ],
  }
);
