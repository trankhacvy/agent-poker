import fp from "fastify-plugin";
import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import type { SolanaClient } from "./solana-write.js";
import type { LlmGateway } from "./llm.js";
import type { WsFeed } from "./websocket-feed.js";
import type {
  GameConfig,
  GameStateSnapshot,
  PlayerSnapshot,
  GameAction,
  WsMessage,
} from "../types.js";

const ACTION_MAP: Record<GameAction["type"], number> = {
  fold: 0,
  check: 1,
  call: 2,
  raise: 3,
  all_in: 4,
};

export class Orchestrator {
  private solanaClient: SolanaClient;
  private llmGateway: LlmGateway;
  private wsFeed: WsFeed;
  private activeGames: Map<string, GameStateSnapshot> = new Map();
  private log: FastifyBaseLogger;

  constructor(
    solanaClient: SolanaClient,
    llmGateway: LlmGateway,
    wsFeed: WsFeed,
    log: FastifyBaseLogger
  ) {
    this.solanaClient = solanaClient;
    this.llmGateway = llmGateway;
    this.wsFeed = wsFeed;
    this.log = log;
  }

  async runGame(
    config: GameConfig
  ): Promise<{ winnerIndex: number; pot: number }> {
    const { gameId, tableId, wagerTier, players } = config;
    this.log.info(
      { gameId, tableId, playerCount: players.length },
      "Starting game"
    );

    const initialPlayers: PlayerSnapshot[] = players.map((p) => ({
      pubkey: p.pubkey,
      displayName: p.displayName,
      template: p.template,
      seatIndex: p.seatIndex,
      status: "active",
      currentBet: 0,
    }));

    const state: GameStateSnapshot = {
      gameId,
      tableId,
      phase: "waiting",
      pot: 0,
      currentBet: 0,
      currentPlayer: 0,
      communityCards: [],
      players: initialPlayers,
    };
    this.activeGames.set(gameId, state);
    this.broadcastState(state, "game_start");

    this.log.info({ gameId }, "Creating game on-chain (L1)");
    await this.solanaClient.createGame(gameId, tableId, wagerTier);
    this.log.info({ gameId }, "Game created on L1");

    for (const player of players) {
      this.log.info(
        { gameId, seat: player.seatIndex, name: player.displayName },
        "Player joining"
      );
      await this.solanaClient.joinGame(
        gameId,
        player.seatIndex,
        player.pubkey
      );
      this.log.info(
        { gameId, seat: player.seatIndex },
        "Player joined"
      );
    }

    this.log.info({ gameId }, "Delegating empty hand PDAs");
    await this.solanaClient.delegateEmptyHands(
      gameId,
      players.length
    );
    this.log.info({ gameId }, "Empty hands delegated");

    this.log.info({ gameId }, "Starting game (delegating to ER)");
    await this.solanaClient.startGame(gameId);
    this.log.info({ gameId }, "GameState delegated to ER");

    const gamePda = this.solanaClient.deriveGamePda(gameId);
    this.log.info({ gameId }, "Waiting for game account on ER");
    await this.solanaClient.waitForErAccount(gamePda);
    this.log.info({ gameId }, "Game account available on ER");

    this.log.info({ gameId }, "Requesting VRF shuffle");
    await this.solanaClient.requestShuffle(gameId);
    this.log.info({ gameId }, "VRF shuffle requested");

    this.log.info({ gameId }, "Waiting for VRF callback");
    let erState = await this.solanaClient.pollForVrfCallback(gameId);
    this.log.info(
      { gameId, phase: erState.phase },
      "VRF callback completed"
    );

    for (let i = 0; i < players.length; i++) {
      let hand: { hand: number[] } | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        hand = await this.solanaClient.getPlayerHand(
          gameId,
          i,
          true
        );
        if (hand && hand.hand[0] !== 255) break;
        this.log.info(
          {
            gameId,
            seat: i,
            attempt: attempt + 1,
            hand: hand?.hand,
          },
          "Hole card fetch retry"
        );
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (hand && hand.hand[0] !== 255) {
        const playerSnapshot = state.players[i];
        if (playerSnapshot) {
          playerSnapshot.holeCards = [hand.hand[0]!, hand.hand[1]!];
          this.log.info(
            {
              gameId,
              seat: i,
              cards: [hand.hand[0], hand.hand[1]],
            },
            "Hole cards fetched"
          );
        }
      } else {
        this.log.warn(
          { gameId, seat: i },
          "Could not fetch hole cards"
        );
      }
    }

    state.bigBlind =
      erState.currentBet > 0 ? erState.currentBet : 1;
    this.log.info(
      { gameId, bigBlind: state.bigBlind, pot: erState.pot },
      "Blinds set"
    );

    this.syncLocalState(state, erState);
    this.broadcastState(state, "game_state");

    let loopGuard = 0;
    const MAX_LOOP_ITERATIONS = 200;

    while (
      erState.phase !== "showdown" &&
      erState.phase !== "settled" &&
      loopGuard < MAX_LOOP_ITERATIONS
    ) {
      loopGuard++;

      const activePlayers = erState.players.filter(
        (p) => p.status === "active" || p.status === "all_in"
      );
      if (activePlayers.length <= 1) break;

      const currentIdx = erState.currentPlayer;
      const player = state.players[currentIdx];
      if (!player || player.status !== "active") {
        erState =
          (await this.solanaClient.getGameState(gameId, true)) ??
          erState;
        continue;
      }

      this.log.info(
        {
          gameId,
          phase: erState.phase,
          seat: currentIdx,
          name: player.displayName,
        },
        "Requesting LLM action"
      );
      const action = await this.llmGateway.getAction(
        player.template,
        state,
        currentIdx
      );

      const actionCode = ACTION_MAP[action.type] ?? 1; // default to check if unknown
      const raiseAmount = action.amount ?? 0;

      this.log.info(
        {
          gameId,
          phase: erState.phase,
          seat: currentIdx,
          name: player.displayName,
          action: action.type,
          amount: action.amount,
        },
        "Player action decided"
      );

      await this.solanaClient.playerAction(
        gameId,
        actionCode,
        raiseAmount
      );

      this.applyAction(state, currentIdx, action);
      state.lastAction = { playerIndex: currentIdx, action };
      this.broadcastState(state, "game_action");

      const newErState = await this.solanaClient.getGameState(
        gameId,
        true
      );
      if (newErState) {
        erState = newErState;
        this.syncLocalState(state, erState);
      }
    }

    if (
      erState.phase === "showdown" ||
      this.countActivePlayers(state) <= 1
    ) {
      this.log.info({ gameId }, "Running showdown on ER");
      state.phase = "showdown";
      this.broadcastState(state, "game_state");

      await this.solanaClient.showdownTest(gameId);

      const showdownState = await this.solanaClient.getGameState(
        gameId,
        true
      );
      if (showdownState) {
        erState = showdownState;
        this.syncLocalState(state, erState);
      }
    }

    const winnerIndex = erState.winnerIndex ?? 0;
    this.log.info(
      {
        gameId,
        winnerSeat: winnerIndex,
        winnerName: state.players[winnerIndex]?.displayName,
      },
      "Winner determined"
    );

    this.log.info({ gameId }, "Committing game back to L1");
    await this.solanaClient.commitGame(gameId);

    this.log.info({ gameId }, "Waiting for commit to settle on L1");
    await this.solanaClient.waitForBaseLayerSettle(gameId);
    this.log.info({ gameId }, "Game settled on L1");

    state.phase = "settled";
    state.winnerIndex = winnerIndex;
    this.broadcastState(state, "game_end");
    this.activeGames.delete(gameId);

    return { winnerIndex, pot: state.pot };
  }

  getGameState(gameId: string): GameStateSnapshot | undefined {
    return this.activeGames.get(gameId);
  }

  private syncLocalState(
    local: GameStateSnapshot,
    er: GameStateSnapshot
  ): void {
    local.phase = er.phase;
    local.pot = er.pot;
    local.currentBet = er.currentBet;
    local.currentPlayer = er.currentPlayer;
    local.communityCards = er.communityCards;

    for (let i = 0; i < local.players.length; i++) {
      const erPlayer = er.players[i];
      const localPlayer = local.players[i];
      if (erPlayer && localPlayer) {
        localPlayer.status = erPlayer.status;
        localPlayer.currentBet = erPlayer.currentBet;
      }
    }
  }

  private countActivePlayers(state: GameStateSnapshot): number {
    return state.players.filter(
      (p) => p.status === "active" || p.status === "all_in"
    ).length;
  }

  private applyAction(
    state: GameStateSnapshot,
    playerIdx: number,
    action: GameAction
  ): void {
    const player = state.players[playerIdx]!;

    switch (action.type) {
      case "fold":
        player.status = "folded";
        break;
      case "check":
        break;
      case "call": {
        const callAmount = state.currentBet - player.currentBet;
        player.currentBet = state.currentBet;
        state.pot += callAmount;
        action.amount = callAmount;
        break;
      }
      case "raise": {
        const raiseTotal =
          action.amount ?? state.currentBet * 2;
        const added = raiseTotal - player.currentBet;
        player.currentBet = raiseTotal;
        state.currentBet = raiseTotal;
        state.pot += added;
        break;
      }
      case "all_in": {
        player.status = "all_in";
        const allInAmount =
          state.currentBet - player.currentBet;
        player.currentBet = state.currentBet;
        state.pot += allInAmount;
        break;
      }
    }
  }

  private broadcastState(
    state: GameStateSnapshot,
    type: WsMessage["type"]
  ): void {
    const message: WsMessage = {
      type,
      data: state,
      gameId: state.gameId,
      tableId: state.tableId,
      timestamp: Date.now(),
    };
    this.wsFeed.broadcastToGame(state.gameId, message);
    // Also broadcast to the arena channel so arena spectators see game updates
    this.wsFeed.broadcastToChannel("arena", message);
  }
}

declare module "fastify" {
  interface FastifyInstance {
    orchestrator: Orchestrator;
  }
}

export default fp(
  async (fastify: FastifyInstance) => {
    const orchestrator = new Orchestrator(
      fastify.solanaWrite,
      fastify.llm,
      fastify.wsFeed,
      fastify.log
    );
    fastify.decorate("orchestrator", orchestrator);
    fastify.log.info("Orchestrator plugin loaded");
  },
  {
    name: "orchestrator",
    dependencies: ["solana-write", "llm", "websocket-feed"],
  }
);
