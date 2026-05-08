import fp from "fastify-plugin";
import Redis from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}

export const redisPlugin = fp(async (server) => {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redis.on("error", (err) => {
    server.log.error({ err }, "Redis connection error");
  });

  await redis.ping();
  server.decorate("redis", redis);

  server.addHook("onClose", async () => {
    await redis.quit();
  });
});
