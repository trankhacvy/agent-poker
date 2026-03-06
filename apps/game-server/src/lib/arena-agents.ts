import { Keypair } from "@solana/web3.js";
import crypto from "node:crypto";

export interface ArenaAgentConfig {
  id: string;
  pubkey: string;
  displayName: string;
  template: number;
  personality: string;
  avatar: string;
  color: string;
}

function deriveKeypair(seed: string): Keypair {
  const hash = crypto.createHash("sha256").update(seed).digest();
  return Keypair.fromSeed(hash);
}

const AGENT_SEEDS = [
  "arena-agent-shark",
  "arena-agent-maniac",
  "arena-agent-rock",
  "arena-agent-fox",
  "arena-agent-owl",
  "arena-agent-wolf",
];

export const AGENT_KEYPAIRS = AGENT_SEEDS.map(deriveKeypair);

export const ARENA_AGENTS: ArenaAgentConfig[] = [
  {
    id: "shark",
    pubkey: AGENT_KEYPAIRS[0]!.publicKey.toBase58(),
    displayName: "Shark",
    template: 0,
    personality: "Calculated and patient. Strikes when the odds favor.",
    avatar: "/agents/shark.png",
    color: "#3B82F6",
  },
  {
    id: "maniac",
    pubkey: AGENT_KEYPAIRS[1]!.publicKey.toBase58(),
    displayName: "Maniac",
    template: 1,
    personality: "Wild and unpredictable. Lives for the bluff.",
    avatar: "/agents/maniac.png",
    color: "#EF4444",
  },
  {
    id: "rock",
    pubkey: AGENT_KEYPAIRS[2]!.publicKey.toBase58(),
    displayName: "Rock",
    template: 2,
    personality: "Immovable. Only plays premium hands.",
    avatar: "/agents/rock.png",
    color: "#6B7280",
  },
  {
    id: "fox",
    pubkey: AGENT_KEYPAIRS[3]!.publicKey.toBase58(),
    displayName: "Fox",
    template: 3,
    personality: "Cunning and adaptive. Changes strategy to exploit.",
    avatar: "/agents/fox.png",
    color: "#F59E0B",
  },
  {
    id: "owl",
    pubkey: AGENT_KEYPAIRS[4]!.publicKey.toBase58(),
    displayName: "Owl",
    template: 4,
    personality: "Analytical precision. Plays by the numbers.",
    avatar: "/agents/owl.png",
    color: "#8B5CF6",
  },
  {
    id: "wolf",
    pubkey: AGENT_KEYPAIRS[5]!.publicKey.toBase58(),
    displayName: "Wolf",
    template: 5,
    personality: "Relentless aggression in position.",
    avatar: "/agents/wolf.png",
    color: "#10B981",
  },
];

export function getArenaAgentByPubkey(
  pubkey: string
): ArenaAgentConfig | undefined {
  return ARENA_AGENTS.find((a) => a.pubkey === pubkey);
}
