import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";

export class GameTracker {
  private count = 0;

  increment(): void {
    this.count++;
  }

  decrement(): void {
    if (this.count > 0) this.count--;
  }

  get activeCount(): number {
    return this.count;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    gameTracker: GameTracker;
  }
}

export default fp(
  async (fastify: FastifyInstance) => {
    fastify.decorate("gameTracker", new GameTracker());
  },
  { name: "game-tracker" }
);
