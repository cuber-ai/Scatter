import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";

const CreateAffiliateSchema = z.object({});

export async function affiliateRoutes(server: FastifyInstance) {
  // ── POST /api/v1/affiliate/join ───────────────────────────────────────────
  server.post(
    "/join",
    { preHandler: [server.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req.user as { sub: string }).sub;

      const existing = await server.prisma.affiliateProfile.findUnique({
        where: { userId },
      });
      if (existing) {
        return reply.status(409).send({ error: "Already an affiliate." });
      }

      const referralCode = nanoid(8).toUpperCase();

      const profile = await server.prisma.affiliateProfile.create({
        data: {
          userId,
          referralCode,
          rank: "BRONZE",
          commissionRate: 0.05,
        },
        select: {
          id: true,
          referralCode: true,
          rank: true,
          commissionRate: true,
          createdAt: true,
        },
      });

      // Create commission wallet
      await server.prisma.wallet.upsert({
        where: {
          userId_type_currency: { userId, type: "COMMISSION", currency: "PHP" },
        },
        update: {},
        create: { userId, type: "COMMISSION", currency: "PHP" },
      });

      return reply.status(201).send({ profile });
    }
  );

  // ── GET /api/v1/affiliate/dashboard ──────────────────────────────────────
  server.get(
    "/dashboard",
    { preHandler: [server.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req.user as { sub: string }).sub;

      const profile = await server.prisma.affiliateProfile.findUnique({
        where: { userId },
        include: {
          referrals: {
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
              createdAt: true,
              convertedAt: true,
              conversionValue: true,
            },
          },
          commissions: {
            orderBy: { createdAt: "desc" },
            take: 50,
            select: { amount: true, tier: true, sourceType: true, createdAt: true },
          },
        },
      });

      if (!profile) {
        return reply.status(404).send({ error: "Not an affiliate." });
      }

      const wallet = await server.prisma.wallet.findFirst({
        where: { userId, type: "COMMISSION", currency: "PHP" },
      });

      return reply.send({
        profile: {
          referralCode: profile.referralCode,
          rank: profile.rank,
          commissionRate: profile.commissionRate,
          totalEarned: Number(profile.totalEarned),
          pendingPayout: Number(profile.pendingPayout),
          commissionBalance: wallet ? Number(wallet.balance) : 0,
        },
        referrals: profile.referrals,
        commissions: profile.commissions,
      });
    }
  );

  // ── GET /api/v1/affiliate/report ──────────────────────────────────────────
  server.get(
    "/report",
    { preHandler: [server.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req.user as { sub: string }).sub;
      const query = req.query as { format?: string };

      const profile = await server.prisma.affiliateProfile.findUnique({
        where: { userId },
        include: {
          commissions: {
            orderBy: { createdAt: "desc" },
            select: {
              amount: true,
              tier: true,
              sourceType: true,
              paidAt: true,
              createdAt: true,
            },
          },
        },
      });

      if (!profile) {
        return reply.status(404).send({ error: "Not an affiliate." });
      }

      if (query.format === "csv") {
        const csv = [
          "amount,tier,sourceType,paidAt,createdAt",
          ...profile.commissions.map(
            (c) =>
              `${c.amount},${c.tier},${c.sourceType},${c.paidAt?.toISOString() ?? ""},${c.createdAt.toISOString()}`
          ),
        ].join("\n");

        return reply
          .header("Content-Type", "text/csv")
          .header(
            "Content-Disposition",
            `attachment; filename="affiliate-report.csv"`
          )
          .send(csv);
      }

      return reply.send({ commissions: profile.commissions });
    }
  );
}
