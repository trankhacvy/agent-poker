import type { SolanaClient } from "./solana-client.js";
import type { LlmGateway } from "./llm-gateway.js";
import type { WsFeed } from "./ws-feed.js";
import type {
  GameConfig,
  GameStateSnapshot,
  PlayerSnapshot,
  GameAction,
  WsMessage,
} from "./types.js";

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

  constructor(
    solanaClient: SolanaClient,
    llmGateway: LlmGateway,
    wsFeed: WsFeed
  ) {
    this.solanaClient = solanaClient;
    this.llmGateway = llmGateway;
    this.wsFeed = wsFeed;
  }

  async runGame(config: GameConfig): Promise<{ winnerIndex: number; pot: number }> {
    const { gameId, tableId, wagerTier, players } = config;
    console.log(`[Orchestrator] Starting game ${gameId} on table ${tableId} with ${players.length} players`);

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

    console.log(`[Orchestrator] Creating game on-chain (L1)...`);
    await this.solanaClient.createGame(gameId, tableId, wagerTier);
    console.log(`[Orchestrator] Game created on L1`);

    for (const player of players) {
      console.log(`[Orchestrator] Player ${player.seatIndex} (${player.displayName}) joining...`);
      await this.solanaClient.joinGame(gameId, player.seatIndex, player.pubkey);
      console.log(`[Orchestrator] Player ${player.seatIndex} joined`);
    }

    console.log(`[Orchestrator] Delegating empty hand PDAs...`);
    await this.solanaClient.delegateEmptyHands(gameId, players.length);
    console.log(`[Orchestrator] Empty hands delegated`);

    console.log(`[Orchestrator] Starting game (delegating to ER)...`);
    await this.solanaClient.startGame(gameId);
    console.log(`[Orchestrator] GameState delegated to ER`);

    const gamePda = this.solanaClient.deriveGamePda(gameId);
    console.log(`[Orchestrator] Waiting for game account on ER...`);
    await this.solanaClient.waitForErAccount(gamePda);
    console.log(`[Orchestrator] Game account available on ER`);

    console.log(`[Orchestrator] Requesting VRF shuffle...`);
    await this.solanaClient.requestShuffle(gameId);
    console.log(`[Orchestrator] VRF shuffle requested`);

    console.log(`[Orchestrator] Waiting for VRF callback...`);
    let erState = await this.solanaClient.pollForVrfCallback(gameId);
    console.log(`[Orchestrator] VRF callback completed, phase: ${erState.phase}`);

    for (let i = 0; i < players.length; i++) {
      let hand: { hand: number[] } | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        hand = await this.solanaClient.getPlayerHand(gameId, i, true);
        if (hand && hand.hand[0] !== 255) break;
        console.log(`[Orchestrator] Hole card fetch attempt ${attempt + 1} for seat ${i}: ${hand ? `got [${hand.hand}]` : "null"}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (hand && hand.hand[0] !== 255) {
        const playerSnapshot = state.players[i];
        if (playerSnapshot) {
          playerSnapshot.holeCards = [hand.hand[0]!, hand.hand[1]!];
          console.log(`[Orchestrator] Seat ${i} hole cards: [${hand.hand[0]}, ${hand.hand[1]}]`);
        }
      } else {
        console.log(`[Orchestrator] WARNING: Could not fetch hole cards for seat ${i}`);
      }
    }

    state.bigBlind = erState.currentBet > 0 ? erState.currentBet : 1;
    console.log(`[Orchestrator] Big blind: ${state.bigBlind}, Pot: ${erState.pot}`);

    this.syncLocalState(state, erState);
    this.broadcastState(state, "game_state");

    const MAX_RAISES_PER_STREET = 4;
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
        erState = (await this.solanaClient.getGameState(gameId, true)) ?? erState;
        continue;
      }

      console.log(`[Orchestrator] [${erState.phase}] Seat ${currentIdx} (${player.displayName}) requesting LLM action...`);
      const action = await this.llmGateway.getAction(
        player.template,
        state,
        currentIdx
      );

      const actionCode = ACTION_MAP[action.type];
      const raiseAmount = action.amount ?? 0;

      console.log(`[Orchestrator] [${erState.phase}] Seat ${currentIdx} (${player.displayName}): ${action.type}${action.amount ? ` ${action.amount}` : ""}`);

      await this.solanaClient.playerAction(gameId, actionCode, raiseAmount);

      this.applyAction(state, currentIdx, action);
      state.lastAction = { playerIndex: currentIdx, action };
      this.broadcastState(state, "game_action");

      const newErState = await this.solanaClient.getGameState(gameId, true);
      if (newErState) {
        erState = newErState;
        this.syncLocalState(state, erState);
      }
    }

    if (erState.phase === "showdown" || this.countActivePlayers(state) <= 1) {
      console.log(`[Orchestrator] Running showdown on ER...`);
      state.phase = "showdown";
      this.broadcastState(state, "game_state");

      await this.solanaClient.showdownTest(gameId);

      const showdownState = await this.solanaClient.getGameState(gameId, true);
      if (showdownState) {
        erState = showdownState;
        this.syncLocalState(state, erState);
      }
    }

    const winnerIndex = erState.winnerIndex ?? 0;
    console.log(`[Orchestrator] Winner: seat ${winnerIndex} (${state.players[winnerIndex]?.displayName})`);

    console.log(`[Orchestrator] Committing game back to L1...`);
    await this.solanaClient.commitGame(gameId);

    console.log(`[Orchestrator] Waiting for commit to settle on L1...`);
    await this.solanaClient.waitForBaseLayerSettle(gameId);
    console.log(`[Orchestrator] Game settled on L1`);

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
        break;
      }
      case "raise": {
        const raiseTotal = action.amount ?? state.currentBet * 2;
        const added = raiseTotal - player.currentBet;
        player.currentBet = raiseTotal;
        state.currentBet = raiseTotal;
        state.pot += added;
        break;
      }
      case "all_in": {
        player.status = "all_in";
        const allInAmount = state.currentBet - player.currentBet;
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
    this.wsFeed.broadcastToGame(state.gameId, {
      type,
      data: state,
      gameId: state.gameId,
      tableId: state.tableId,
      timestamp: Date.now(),
    });
  }
}
