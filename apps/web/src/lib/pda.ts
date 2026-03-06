import {
  getProgramDerivedAddress,
  getU64Encoder,
  getAddressEncoder,
  type Address,
  address,
} from "@solana/kit";
import { GAME_PROGRAM_ID, BETTING_PROGRAM_ID, AGENT_PROGRAM_ID } from "./constants";

const GAME_SEED = new TextEncoder().encode("poker_game");
const HAND_SEED = new TextEncoder().encode("player_hand");
const POOL_SEED = new TextEncoder().encode("bet_pool");
const AGENT_SEED = new TextEncoder().encode("agent");

const gameProgramAddress = address(GAME_PROGRAM_ID);
const bettingProgramAddress = address(BETTING_PROGRAM_ID);
const agentProgramAddress = address(AGENT_PROGRAM_ID);

/**
 * Convert a UUID (or numeric string) to a u64 bigint,
 * matching the server's `toBn()` logic in solana-write.ts:89-93.
 */
export function idToU64(value: string): bigint {
  if (/^\d+$/.test(value)) return BigInt(value);
  return BigInt("0x" + value.replace(/-/g, "").slice(0, 16));
}

export async function deriveGamePda(gameId: string): Promise<Address> {
  const idBytes = getU64Encoder().encode(idToU64(gameId));
  const [pda] = await getProgramDerivedAddress({
    programAddress: gameProgramAddress,
    seeds: [GAME_SEED, idBytes],
  });
  return pda;
}

export async function derivePlayerHandPda(
  gameId: string,
  seatIndex: number
): Promise<Address> {
  const idBytes = getU64Encoder().encode(idToU64(gameId));
  const [pda] = await getProgramDerivedAddress({
    programAddress: gameProgramAddress,
    seeds: [HAND_SEED, idBytes, new Uint8Array([seatIndex])],
  });
  return pda;
}

export async function derivePoolPda(tableId: string): Promise<Address> {
  const idBytes = getU64Encoder().encode(idToU64(tableId));
  const [pda] = await getProgramDerivedAddress({
    programAddress: bettingProgramAddress,
    seeds: [POOL_SEED, idBytes],
  });
  return pda;
}

export async function deriveAgentPda(ownerPubkey: string): Promise<Address> {
  const ownerBytes = getAddressEncoder().encode(address(ownerPubkey));
  const [pda] = await getProgramDerivedAddress({
    programAddress: agentProgramAddress,
    seeds: [AGENT_SEED, ownerBytes],
  });
  return pda;
}
