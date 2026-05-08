import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { hash, verify } from "argon2";
import { nanoid } from "nanoid";

const RegisterSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128)
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[0-9]/, "Must contain a digit")
    .regex(/[^A-Za-z0-9]/, "Must contain a special character"),
  referralCode: z.string().optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function authRoutes(server: FastifyInstance) {
  // ── POST /api/v1/auth/register ────────────────────────────────────────────
  server.post(
    "/register",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = RegisterSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }
      const { email, username, password, referralCode } = body.data;

      const existing = await server.prisma.user.findFirst({
        where: { OR: [{ email }, { username }] },
      });
      if (existing) {
        return reply.status(409).send({ error: "Email or username taken." });
      }

      const passwordHash = await hash(password, {
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });

      const user = await server.prisma.user.create({
        data: {
          email,
          username,
          passwordHash,
          wallets: {
            create: [
              { type: "MAIN", currency: "PHP" },
              { type: "BONUS", currency: "PHP" },
            ],
          },
          affiliateRef: referralCode
            ? {
                create: {
                  affiliateId: await resolveAffiliateId(server, referralCode),
                  fraudScore: 0,
                },
              }
            : undefined,
        },
        select: { id: true, email: true, username: true, role: true },
      });

      await server.prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "USER_REGISTER",
          resource: "user",
          resourceId: user.id,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      });

      return reply.status(201).send({ user });
    }
  );

  // ── POST /api/v1/auth/login ────────────────────────────────────────────────
  server.post(
    "/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = LoginSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }
      const { email, password, totpCode } = body.data;

      const user = await server.prisma.user.findUnique({ where: { email } });
      if (!user || user.isBanned || !user.isActive) {
        return reply.status(401).send({ error: "Invalid credentials." });
      }

      const valid = await verify(user.passwordHash, password);
      if (!valid) {
        await server.prisma.auditLog.create({
          data: {
            userId: user.id,
            action: "LOGIN_FAILED",
            resource: "user",
            resourceId: user.id,
            ipAddress: req.ip,
          },
        });
        return reply.status(401).send({ error: "Invalid credentials." });
      }

      // TOTP check
      if (user.mfaEnabled) {
        if (!totpCode) {
          return reply.status(401).send({
            error: "MFA required.",
            mfaRequired: true,
          });
        }
        const { TOTP } = await import("otpauth");
        const totp = new TOTP({ secret: user.mfaSecret! });
        if (totp.validate({ token: totpCode }) === null) {
          return reply.status(401).send({ error: "Invalid MFA code." });
        }
      }

      const accessToken = server.jwt.sign(
        { sub: user.id, role: user.role },
        { expiresIn: process.env.JWT_EXPIRES_IN ?? "15m" }
      );

      const refreshToken = nanoid(64);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await server.prisma.playerSession.create({
        data: {
          userId: user.id,
          token: refreshToken,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"] ?? "unknown",
          expiresAt,
        },
      });

      // Enforce password rotation for accounts where passwordChangedAt is null
      const requiresPasswordChange = user.passwordChangedAt === null;

      await server.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), lastLoginIp: req.ip },
      });

      await server.prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "LOGIN_SUCCESS",
          resource: "user",
          resourceId: user.id,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        },
      });

      return reply.send({
        accessToken,
        refreshToken,
        requiresPasswordChange,
        user: { id: user.id, email: user.email, role: user.role },
      });
    }
  );

  // ── POST /api/v1/auth/refresh ─────────────────────────────────────────────
  server.post("/refresh", async (req: FastifyRequest, reply: FastifyReply) => {
    const body = RefreshSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Invalid request." });
    }

    const session = await server.prisma.playerSession.findUnique({
      where: { token: body.data.refreshToken },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      return reply.status(401).send({ error: "Invalid or expired session." });
    }

    const accessToken = server.jwt.sign(
      { sub: session.userId, role: session.user.role },
      { expiresIn: process.env.JWT_EXPIRES_IN ?? "15m" }
    );

    return reply.send({ accessToken });
  });

  // ── POST /api/v1/auth/logout ──────────────────────────────────────────────
  server.post(
    "/logout",
    { preHandler: [server.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = RefreshSchema.safeParse(req.body);
      if (body.success) {
        await server.prisma.playerSession.deleteMany({
          where: { token: body.data.refreshToken },
        });
      }
      return reply.send({ success: true });
    }
  );
}

async function resolveAffiliateId(
  server: FastifyInstance,
  referralCode: string
): Promise<string> {
  const affiliate = await server.prisma.affiliateProfile.findUnique({
    where: { referralCode },
  });
  if (!affiliate) throw new Error(`Invalid referral code: ${referralCode}`);
  return affiliate.id;
}
