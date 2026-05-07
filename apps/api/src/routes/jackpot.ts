import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export async function jackpotRoutes(server: FastifyInstance) {
  // ── GET /api/v1/jackpot/pools ─────────────────────────────────────────────
  server.get("/pools", async (_req, reply) => {
    const dbPools = await server.prisma.jackpotPool.findMany({
      select: {
        tier: true,
        baseAmount: true,
        currency: true,
        lastWonAt: true,
      },
    });

    // Merge with live Redis values for realtime accuracy
    const pools = await Promise.all(
      dbPools.map(async (pool) => {
        const liveAmountStr = await server.redis.get(`jackpot:${pool.tier}`);
        const liveAmount = liveAmountStr
          ? Number(liveAmountStr)
          : Number(pool.baseAmount);
        return {
          ...pool,
          currentAmount: liveAmount,
        };
      })
    );

    return reply.send({ pools });
  });

  // ── GET /api/v1/jackpot/winners ───────────────────────────────────────────
  server.get("/winners", async (req, reply) => {
    const query = req.query as { limit?: string };
    const limit = Math.min(50, Number(query.limit ?? 10));

    const winners = await server.prisma.jackpotWin.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        tier: true,
        amount: true,
        createdAt: true,
        pool: { select: { currency: true } },
      },
    });

    return reply.send({ winners });
  });
}
