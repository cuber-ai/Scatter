import { FastifyInstance } from "fastify";

export async function healthRoutes(server: FastifyInstance) {
  server.get("/", async (_req, reply) => {
    let dbOk = false;
    let redisOk = false;

    try {
      await server.prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch (_) {}

    try {
      await server.redis.ping();
      redisOk = true;
    } catch (_) {}

    const healthy = dbOk && redisOk;

    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      services: { database: dbOk, redis: redisOk },
    });
  });
}
