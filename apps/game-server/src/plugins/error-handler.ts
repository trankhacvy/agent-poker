import fp from "fastify-plugin";
import type { FastifyInstance, FastifyError } from "fastify";

export default fp(
  async (fastify: FastifyInstance) => {
    fastify.setErrorHandler((error: FastifyError, _request, reply) => {
      const statusCode = error.statusCode ?? 500;
      fastify.log.error(
        { err: error, statusCode },
        "Request error"
      );
      reply.status(statusCode).send({
        statusCode,
        error: error.name ?? "Error",
        message: error.message,
      });
    });
  },
  { name: "error-handler" }
);
