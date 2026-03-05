import fp from "fastify-plugin";
import { z } from "zod";
import type { FastifyInstance } from "fastify";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3001),
  LLM_PROVIDER: z.enum(["gemini", "openrouter"]).default("gemini"),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),
  SOLANA_RPC_URL: z.string().url().default("https://api.devnet.solana.com"),
  AUTHORITY_PRIVATE_KEY: z.string().optional(),
  AUTHORITY_KEYPAIR_PATH: z.string().optional(),
  EPHEMERAL_PROVIDER_ENDPOINT: z
    .string()
    .url()
    .default("https://devnet.magicblock.app/"),
  EPHEMERAL_WS_ENDPOINT: z
    .string()
    .default("wss://devnet.magicblock.app/"),
  AUTO_MATCH_INTERVAL_MS: z.coerce.number().positive().default(10000),
  AUTO_MATCH_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  ARENA_MODE_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  ARENA_REQUIRE_BETS: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
}).refine(
  (d) => d.AUTHORITY_PRIVATE_KEY || d.AUTHORITY_KEYPAIR_PATH,
  {
    message:
      "Either AUTHORITY_PRIVATE_KEY or AUTHORITY_KEYPAIR_PATH must be set",
  }
);

export type Env = z.infer<typeof EnvSchema>;

declare module "fastify" {
  interface FastifyInstance {
    env: Env;
  }
}

export default fp(
  async (fastify: FastifyInstance) => {
    const result = EnvSchema.safeParse(process.env);
    if (!result.success) {
      fastify.log.error(
        { issues: result.error.issues },
        "Invalid environment variables"
      );
      throw new Error(
        `Env validation failed: ${result.error.issues.map((i) => i.message).join(", ")}`
      );
    }
    fastify.decorate("env", result.data);
    fastify.log.info("Env plugin loaded");
  },
  { name: "env" }
);
