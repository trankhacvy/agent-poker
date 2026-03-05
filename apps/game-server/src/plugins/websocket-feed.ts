import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import type { WsMessage } from "../types.js";

interface ClientSubscription {
  socket: WebSocket;
  gameIds: Set<string>;
  tableIds: Set<string>;
  channels: Set<string>;
}

export class WsFeed {
  private clients: Map<WebSocket, ClientSubscription> = new Map();

  registerRoutes(fastify: FastifyInstance): void {
    fastify.get("/ws", { websocket: true }, (socket) => {
      const subscription: ClientSubscription = {
        socket,
        gameIds: new Set(),
        tableIds: new Set(),
        channels: new Set(),
      };
      this.clients.set(socket, subscription);

      socket.on("message", (raw: WebSocket.Data) => {
        try {
          const msg: {
            type: string;
            gameId?: string;
            tableId?: string;
            channel?: string;
          } = JSON.parse(raw.toString());

          if (msg.type === "subscribe") {
            if (msg.gameId) subscription.gameIds.add(msg.gameId);
            if (msg.tableId) subscription.tableIds.add(msg.tableId);
            if (msg.channel) subscription.channels.add(msg.channel);
            socket.send(
              JSON.stringify({
                type: "subscribe_ack",
                data: { message: "subscribed" },
                gameId: msg.gameId,
                tableId: msg.tableId,
                channel: msg.channel,
                timestamp: Date.now(),
              })
            );
          } else if (msg.type === "unsubscribe") {
            if (msg.gameId)
              subscription.gameIds.delete(msg.gameId);
            if (msg.tableId)
              subscription.tableIds.delete(msg.tableId);
            if (msg.channel)
              subscription.channels.delete(msg.channel);
          }
        } catch {
          // ignore malformed messages
        }
      });

      socket.on("close", () => {
        this.clients.delete(socket);
      });

      socket.on("error", () => {
        this.clients.delete(socket);
      });
    });
  }

  broadcast(message: WsMessage): void {
    const payload = JSON.stringify(message);
    for (const [socket] of this.clients) {
      if (socket.readyState === 1) {
        socket.send(payload);
      }
    }
  }

  broadcastToGame(gameId: string, message: WsMessage): void {
    const payload = JSON.stringify(message);
    const tableId = message.tableId;
    for (const [socket, sub] of this.clients) {
      if (socket.readyState !== 1) continue;
      if (
        sub.gameIds.has(gameId) ||
        (tableId && sub.tableIds.has(tableId))
      ) {
        socket.send(payload);
      }
    }
  }

  broadcastToChannel(channel: string, message: WsMessage): void {
    const payload = JSON.stringify(message);
    for (const [socket, sub] of this.clients) {
      if (socket.readyState !== 1) continue;
      if (sub.channels.has(channel)) {
        socket.send(payload);
      }
    }
  }
}

declare module "fastify" {
  interface FastifyInstance {
    wsFeed: WsFeed;
  }
}

export default fp(
  async (fastify: FastifyInstance) => {
    const feed = new WsFeed();
    fastify.decorate("wsFeed", feed);
    feed.registerRoutes(fastify);
    fastify.log.info("WebSocket feed plugin loaded");
  },
  { name: "websocket-feed" }
);
