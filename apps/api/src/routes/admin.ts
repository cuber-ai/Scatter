import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN", "MODERATOR"] as const;

function requireAdmin(server: FastifyInstance) {
  return [
    server.authenticate,
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user as { sub: string; role: string };
      if (!ADMIN_ROLES.includes(user.role as (typeof ADMIN_ROLES)[number])) {
        return reply.status(403).send({ error: "Forbidden." });
      }
    },
  ];
}

const BanUserSchema = z.object({
  userId: z.string(),
  reason: z.string().min(10),
});

const UpdateRtpSchema = z.object({
  gameConfigId: z.string(),
  rtp: z.number().min(85).max(99),
});

export async function adminRoutes(server: FastifyInstance) {
  // ── GET /api/v1/admin/players ─────────────────────────────────────────────
  server.get(
    "/players",
    { preHandler: requireAdmin(server) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as {
        page?: string;
        limit?: string;
        search?: string;
        role?: string;
        fraudAction?: string;
      };
      const page = Math.max(1, Number(query.page ?? 1));
      const limit = Math.min(100, Number(query.limit ?? 30));

      const where = {
        ...(query.search
          ? {
              OR: [
                { email: { contains: query.search, mode: "insensitive" as const } },
                { username: { contains: query.search, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...(query.role ? { role: query.role as "PLAYER" } : {}),
        ...(query.fraudAction
          ? { fraudAction: query.fraudAction as "NONE" }
          : {}),
      };

      const [players, total] = await Promise.all([
        server.prisma.user.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            isActive: true,
            isBanned: true,
            fraudAction: true,
            kycStatus: true,
            lastLoginAt: true,
            createdAt: true,
          },
        }),
        server.prisma.user.count({ where }),
      ]);

      return reply.send({ players, total, page, limit });
    }
  );

  // ── POST /api/v1/admin/players/ban ────────────────────────────────────────
  server.post(
    "/players/ban",
    { preHandler: requireAdmin(server) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = BanUserSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      const adminUser = req.user as { sub: string; role: string };
      const { userId, reason } = body.data;

      await server.prisma.user.update({
        where: { id: userId },
        data: { isBanned: true, banReason: reason, fraudAction: "BANNED" },
      });

      await server.prisma.auditLog.create({
        data: {
          adminId: adminUser.sub,
          userId,
          action: "USER_BANNED",
          resource: "user",
          resourceId: userId,
          after: { reason },
          ipAddress: req.ip,
        },
      });

      return reply.send({ success: true });
    }
  );

  // ── PATCH /api/v1/admin/game/rtp ──────────────────────────────────────────
  server.patch(
    "/game/rtp",
    { preHandler: requireAdmin(server) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = UpdateRtpSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      const adminUser = req.user as { sub: string };
      const { gameConfigId, rtp } = body.data;

      const before = await server.prisma.gameConfig.findUnique({
        where: { id: gameConfigId },
      });

      const updated = await server.prisma.gameConfig.update({
        where: { id: gameConfigId },
        data: { rtp },
      });

      await server.prisma.auditLog.create({
        data: {
          adminId: adminUser.sub,
          action: "RTP_UPDATED",
          resource: "gameConfig",
          resourceId: gameConfigId,
          before: { rtp: before?.rtp },
          after: { rtp },
          ipAddress: req.ip,
        },
      });

      return reply.send({ config: updated });
    }
  );

  // ── GET /api/v1/admin/fraud/events ────────────────────────────────────────
  server.get(
    "/fraud/events",
    { preHandler: requireAdmin(server) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as {
        page?: string;
        limit?: string;
        severity?: string;
        resolved?: string;
      };
      const page = Math.max(1, Number(query.page ?? 1));
      const limit = Math.min(100, Number(query.limit ?? 30));

      const [events, total] = await Promise.all([
        server.prisma.fraudEvent.findMany({
          where: {
            ...(query.severity ? { severity: query.severity } : {}),
            ...(query.resolved !== undefined
              ? { resolved: query.resolved === "true" }
              : {}),
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        server.prisma.fraudEvent.count(),
      ]);

      return reply.send({ events, total, page, limit });
    }
  );

  // ── GET /api/v1/admin/jackpot/controls ────────────────────────────────────
  server.get(
    "/jackpot/controls",
    { preHandler: requireAdmin(server) },
    async (_req, reply) => {
      const pools = await server.prisma.jackpotPool.findMany({
        include: {
          wins: {
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      });

      // Enrich with live Redis amounts
      const enriched = await Promise.all(
        pools.map(async (pool: (typeof pools)[number]) => {
          const live = await server.redis.get(`jackpot:${pool.tier}`);
          return { ...pool, liveAmount: live ? Number(live) : Number(pool.currentAmount) };
        })
      );

      return reply.send({ pools: enriched });
    }
  );

  // ── GET /api/v1/admin/audit-logs ──────────────────────────────────────────
  server.get(
    "/audit-logs",
    { preHandler: requireAdmin(server) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as { page?: string; limit?: string };
      const page = Math.max(1, Number(query.page ?? 1));
      const limit = Math.min(100, Number(query.limit ?? 50));

      const [logs, total] = await Promise.all([
        server.prisma.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            user: { select: { email: true, username: true } },
          },
        }),
        server.prisma.auditLog.count(),
      ]);

      return reply.send({ logs, total, page, limit });
    }
  );
}
