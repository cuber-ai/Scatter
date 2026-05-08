import { FastifyInstance, FastifyRequest } from "fastify";

export async function rewardRoutes(server: FastifyInstance) {
  server.get(
    "/",
    { preHandler: [server.authenticate] },
    async (req: FastifyRequest, reply) => {
      const userId = (req.user as { sub: string }).sub;

      const rewards = await server.prisma.playerReward.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          value: true,
          expiresAt: true,
          claimedAt: true,
          createdAt: true,
          campaign: { select: { name: true } },
        },
      });

      return reply.send({ rewards });
    }
  );

  server.post(
    "/:rewardId/claim",
    { preHandler: [server.authenticate] },
    async (req: FastifyRequest, reply) => {
      const userId = (req.user as { sub: string }).sub;
      const { rewardId } = req.params as { rewardId: string };

      const reward = await server.prisma.playerReward.findFirst({
        where: { id: rewardId, userId, isActive: true, claimedAt: null },
      });

      if (!reward) {
        return reply.status(404).send({ error: "Reward not found or already claimed." });
      }

      if (reward.expiresAt && reward.expiresAt < new Date()) {
        return reply.status(410).send({ error: "Reward expired." });
      }

      const updated = await server.prisma.playerReward.update({
        where: { id: rewardId },
        data: { claimedAt: new Date() },
      });

      return reply.send({ reward: updated });
    }
  );
}
