import {
  createSolanaRpc,
  address,
  getBase58Decoder,
  type Address,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  fetchMaybeAgentAccount,
  getAgentAccountDecoder,
  getAgentAccountDiscriminatorBytes,
  AGENT_POKER_AGENT_PROGRAM_ADDRESS,
  type AgentAccount,
} from "@repo/program-clients/agent";
import {
  getGameStateDecoder,
  getGameStateDiscriminatorBytes,
  GamePhase,
} from "@repo/program-clients/game";

const AGENT_PROGRAM_ID = AGENT_POKER_AGENT_PROGRAM_ADDRESS;
const GAME_PROGRAM_ID = address("4dnm62opQrwADRgKFoGHrpt8zCWkheTRrs3uVCAa3bRr");

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export interface AgentResponse {
  pubkey: string;
  owner: string;
  displayName: string;
  template: number;
  vault: string;
  balance: number;
  gamesPlayed: number;
  wins: number;
  earnings: number;
  createdAt: number;
}

export interface GameHistoryResponse {
  gameId: string;
  tableId: string;
  wagerTier: number;
  pot: number;
  winnerIndex: number;
  players: {
    pubkey: string;
    displayName: string;
    template: number;
    seatIndex: number;
    isWinner: boolean;
  }[];
  completedAt: number;
}

export interface StatsResponse {
  totalGamesPlayed: number;
  totalAgents: number;
  activeGames: number;
  totalVolume: number;
}

function bigintToNumber(val: bigint): number {
  return Number(val);
}

/** Convert discriminator bytes to base58 string for memcmp filters */
function discriminatorToBase58(discriminatorBytes: Uint8Array | { readonly [index: number]: number; readonly length: number }): string {
  return getBase58Decoder().decode(new Uint8Array(discriminatorBytes as ArrayLike<number>));
}

export class OnChainReader {
  private rpc: Rpc<SolanaRpcApi>;
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly AGENT_TTL = 10_000; // 10s
  private readonly GPA_TTL = 30_000; // 30s

  constructor(rpcUrl: string) {
    this.rpc = createSolanaRpc(rpcUrl);
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCache<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  private mapAgent(
    accountAddress: string,
    data: AgentAccount,
    vaultBalance: number = 0
  ): AgentResponse {
    return {
      pubkey: accountAddress,
      owner: data.owner,
      displayName: data.displayName,
      template: data.template,
      vault: data.vault,
      balance: vaultBalance,
      gamesPlayed: bigintToNumber(data.totalGames),
      wins: bigintToNumber(data.totalWins),
      earnings: bigintToNumber(data.totalEarnings),
      createdAt: bigintToNumber(data.createdAt),
    };
  }

  async getAgent(agentPubkey: string): Promise<AgentResponse | null> {
    const cacheKey = `agent:${agentPubkey}`;
    const cached = this.getCached<AgentResponse>(cacheKey);
    if (cached) return cached;

    try {
      const addr = address(agentPubkey);
      const account = await fetchMaybeAgentAccount(this.rpc, addr);
      if (!account.exists) return null;

      // Fetch vault balance
      let vaultBalance = 0;
      try {
        const balanceResult = await this.rpc
          .getBalance(address(account.data.vault))
          .send();
        vaultBalance = bigintToNumber(balanceResult.value);
      } catch {
        // vault may not exist yet
      }

      const result = this.mapAgent(agentPubkey, account.data, vaultBalance);
      this.setCache(cacheKey, result, this.AGENT_TTL);
      return result;
    } catch {
      return null;
    }
  }

  async getAllAgents(
    offset: number = 0,
    limit: number = 20
  ): Promise<{ agents: AgentResponse[]; total: number }> {
    const cacheKey = "all_agents";
    let allAgents = this.getCached<AgentResponse[]>(cacheKey);

    if (!allAgents) {
      allAgents = await this.fetchAllAgentsGpa();
      this.setCache(cacheKey, allAgents, this.GPA_TTL);
    }

    const paginated = allAgents.slice(offset, offset + limit);
    return { agents: paginated, total: allAgents.length };
  }

  private async fetchAllAgentsGpa(): Promise<AgentResponse[]> {
    try {
      const discriminatorBytes = getAgentAccountDiscriminatorBytes();
      const response = await this.rpc
        .getProgramAccounts(AGENT_PROGRAM_ID, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: discriminatorToBase58(discriminatorBytes) as any,
                encoding: "base58",
              },
            },
          ],
        })
        .send();

      const decoder = getAgentAccountDecoder();
      const agents: AgentResponse[] = [];
      const accounts = response as unknown as {
        pubkey: Address;
        account: { data: [string, string]; executable: boolean; lamports: bigint; owner: Address; space: bigint };
      }[];

      for (const entry of accounts) {
        try {
          const data = Buffer.from(entry.account.data[0], "base64");
          const decoded = decoder.decode(data);
          agents.push(this.mapAgent(entry.pubkey as string, decoded));
        } catch {
          // skip malformed accounts
        }
      }

      return agents;
    } catch {
      return [];
    }
  }

  async getCompletedGames(
    agentPubkey: string,
    offset: number = 0,
    limit: number = 20
  ): Promise<{ games: GameHistoryResponse[]; total: number }> {
    const cacheKey = `games:${agentPubkey}`;
    let allGames = this.getCached<GameHistoryResponse[]>(cacheKey);

    if (!allGames) {
      allGames = await this.fetchCompletedGamesGpa(agentPubkey);
      this.setCache(cacheKey, allGames, this.GPA_TTL);
    }

    // Most recent first
    const sorted = [...allGames].sort((a, b) => b.completedAt - a.completedAt);
    const paginated = sorted.slice(offset, offset + limit);
    return { games: paginated, total: allGames.length };
  }

  private async fetchCompletedGamesGpa(
    agentPubkey: string
  ): Promise<GameHistoryResponse[]> {
    try {
      const discriminatorBytes = getGameStateDiscriminatorBytes();
      const response = await this.rpc
        .getProgramAccounts(GAME_PROGRAM_ID, {
          encoding: "base64",
          filters: [
            {
              memcmp: {
                offset: 0n,
                bytes: discriminatorToBase58(discriminatorBytes) as any,
                encoding: "base58",
              },
            },
          ],
        })
        .send();

      const decoder = getGameStateDecoder();
      const games: GameHistoryResponse[] = [];
      const accounts = response as unknown as {
        pubkey: Address;
        account: { data: [string, string]; executable: boolean; lamports: bigint; owner: Address; space: bigint };
      }[];

      for (const entry of accounts) {
        try {
          const data = Buffer.from(entry.account.data[0], "base64");
          const gs = decoder.decode(data);

          // Only completed games
          if (gs.phase !== GamePhase.Complete) continue;

          // Check if agent participated
          const playerAddresses = Array.from(gs.players)
            .slice(0, gs.playerCount)
            .map((p) => p.toString());
          if (!playerAddresses.includes(agentPubkey)) continue;

          games.push({
            gameId: gs.gameId.toString(),
            tableId: gs.tableId.toString(),
            wagerTier: bigintToNumber(gs.wagerTier),
            pot: bigintToNumber(gs.pot),
            winnerIndex: gs.winnerIndex,
            players: playerAddresses.map((p, i) => ({
              pubkey: p,
              displayName: `Player ${i}`,
              template: 0,
              seatIndex: i,
              isWinner: i === gs.winnerIndex,
            })),
            completedAt: bigintToNumber(gs.lastActionAt),
          });
        } catch {
          // skip malformed accounts
        }
      }

      return games;
    } catch {
      return [];
    }
  }

  async getLeaderboard(): Promise<AgentResponse[]> {
    const { agents } = await this.getAllAgents(0, 100);
    return [...agents].sort((a, b) => b.wins - a.wins);
  }

  async getStats(activeGameCount: number): Promise<StatsResponse> {
    const cacheKey = "stats";
    const cached = this.getCached<StatsResponse>(cacheKey);
    if (cached) {
      return { ...cached, activeGames: activeGameCount };
    }

    const { agents, total: totalAgents } = await this.getAllAgents(0, 10000);

    let totalGamesPlayed = 0;
    let totalVolume = 0;
    for (const agent of agents) {
      totalGamesPlayed += agent.gamesPlayed;
      totalVolume += Math.abs(agent.earnings);
    }
    // Each game has 2+ players, so divide for unique games (approximation)
    totalGamesPlayed = Math.floor(totalGamesPlayed / 2);

    const result: StatsResponse = {
      totalGamesPlayed,
      totalAgents,
      activeGames: activeGameCount,
      totalVolume,
    };
    this.setCache(cacheKey, result, this.GPA_TTL);
    return { ...result, activeGames: activeGameCount };
  }
}
