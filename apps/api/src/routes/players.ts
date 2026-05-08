import { FastifyInstance, FastifyRequest } from "fastify";

export async function playerRoutes(server: FastifyInstance) {
  server.get(
    "/me",
    { preHandler: [server.authenticate] },
    async (req: FastifyRequest, reply) => {
      const userId = (req.user as { sub: string }).sub;

      const user = await server.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          kycStatus: true,
          mfaEnabled: true,
          locale: true,
          timezone: true,
          region: true,
          createdAt: true,
          wallets: {
            select: { type: true, balance: true, currency: true },
          },
          aiProfile: {
            select: {
              churnRisk: true,
              retentionScore: true,
              vipPotential: true,
            },
          },
        },
      });

      if (!user) return reply.status(404).send({ error: "User not found." });

      return reply.send({ user });
    }
  );
}
