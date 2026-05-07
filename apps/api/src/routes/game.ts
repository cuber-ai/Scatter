import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";

const SpinSchema = z.object({
  gameConfigId: z.string(),
  betAmount: z.number().positive(),
  clientSeed: z.string().min(8).max(64),
  nonce: z.number().int().nonnegative(),
});

export async function gameRoutes(server: FastifyInstance) {
  // ── POST /api/v1/game/spin ────────────────────────────────────────────────
  server.post(
    "/spin",
    {
      preHandler: [server.authenticate],
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = SpinSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      const userId = (req.user as { sub: string }).sub;
      const { gameConfigId, betAmount, clientSeed, nonce } = body.data;

      // Replay attack prevention – nonce+clientSeed must be unique per user
      const replayKey = `${userId}:${clientSeed}:${nonce}`;
      const replayHash = Buffer.from(replayKey).toString("base64");

      const existingSpin = await server.prisma.spin.findUnique({
        where: { replayHash },
      });
      if (existingSpin) {
        return reply.status(409).send({ error: "Duplicate spin detected." });
      }

      // Fetch game config
      const gameConfig = await server.prisma.gameConfig.findUnique({
        where: { id: gameConfigId, isActive: true },
      });
      if (!gameConfig) {
        return reply.status(404).send({ error: "Game config not found." });
      }

      // Validate bet amount
      if (
        betAmount < Number(gameConfig.minBet) ||
        betAmount > Number(gameConfig.maxBet)
      ) {
        return reply.status(400).send({
          error: `Bet must be between ${gameConfig.minBet} and ${gameConfig.maxBet} PHP.`,
        });
      }

      // Check wallet balance
      const wallet = await server.prisma.wallet.findFirst({
        where: { userId, type: "MAIN", currency: "PHP" },
      });
      if (!wallet || Number(wallet.balance) < betAmount) {
        return reply.status(402).send({ error: "Insufficient balance." });
      }

      // Server seed for provably fair RNG
      const serverSeed = nanoid(32);
      const { createHash } = await import("crypto");
      const serverSeedHash = createHash("sha256")
        .update(serverSeed)
        .digest("hex");

      // Call Rust game server for deterministic result
      const gameServerUrl =
        process.env.GAME_SERVER_URL ?? "http://localhost:9001";
      const spinResponse = await fetch(`${gameServerUrl}/api/spin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GAME_SERVER_API_KEY}`,
        },
        body: JSON.stringify({
          serverSeed,
          clientSeed,
          nonce,
          betAmount,
          symbolWeights: gameConfig.symbolWeights,
          paylines: gameConfig.paylines,
          rtp: gameConfig.rtp,
        }),
      });

      if (!spinResponse.ok) {
        server.log.error("Game server error: " + spinResponse.status);
        return reply.status(502).send({ error: "Game server unavailable." });
      }

      const spinResult = (await spinResponse.json()) as {
        reelResult: unknown;
        winAmount: number;
        multiplier: number;
        isBonusRound: boolean;
        isJackpot: boolean;
        jackpotTier: string | null;
      };

      // Persist spin + transactions atomically
      const [spin] = await server.prisma.$transaction(async (tx) => {
        // Deduct bet
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: betAmount } },
        });

        // Add win
        if (spinResult.winAmount > 0) {
          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: spinResult.winAmount } },
          });
        }

        const betIdempotencyKey = `bet-${userId}-${replayHash}`;
        const winIdempotencyKey = `win-${userId}-${replayHash}`;

        const spin = await tx.spin.create({
          data: {
            userId,
            gameConfigId,
            betAmount,
            currency: "PHP",
            reelResult: spinResult.reelResult as object,
            winAmount: spinResult.winAmount,
            multiplier: spinResult.multiplier,
            isBonusRound: spinResult.isBonusRound,
            isJackpot: spinResult.isJackpot,
            jackpotTier: spinResult.jackpotTier as
              | "MINI"
              | "MAJOR"
              | "MEGA"
              | "PROGRESSIVE"
              | null,
            serverSeed,
            clientSeed,
            nonce,
            serverSeedHash,
            status: "RESOLVED",
            replayHash,
            processedAt: new Date(),
          },
        });

        await tx.transaction.create({
          data: {
            userId,
            walletId: wallet.id,
            spinId: spin.id,
            type: "BET",
            status: "COMPLETED",
            amount: betAmount,
            currency: "PHP",
            idempotencyKey: betIdempotencyKey,
          },
        });

        if (spinResult.winAmount > 0) {
          await tx.transaction.create({
            data: {
              userId,
              walletId: wallet.id,
              spinId: spin.id,
              type: "WIN",
              status: "COMPLETED",
              amount: spinResult.winAmount,
              currency: "PHP",
              idempotencyKey: winIdempotencyKey,
            },
          });
        }

        return [spin];
      });

      // Contribute to jackpot pools (async, non-blocking)
      contributeToJackpots(server, betAmount).catch((err) =>
        server.log.error({ err }, "Jackpot contribution failed")
      );

      return reply.send({
        spinId: spin.id,
        reelResult: spin.reelResult,
        winAmount: Number(spin.winAmount),
        multiplier: spin.multiplier,
        isBonusRound: spin.isBonusRound,
        isJackpot: spin.isJackpot,
        jackpotTier: spin.jackpotTier,
        serverSeedHash,
        // serverSeed revealed after spin for provably fair verification
        serverSeed,
        clientSeed,
        nonce,
      });
    }
  );

  // ── GET /api/v1/game/history ──────────────────────────────────────────────
  server.get(
    "/history",
    { preHandler: [server.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req.user as { sub: string }).sub;
      const query = (req.query as { page?: string; limit?: string });
      const page = Math.max(1, Number(query.page ?? 1));
      const limit = Math.min(50, Number(query.limit ?? 20));

      const [spins, total] = await Promise.all([
        server.prisma.spin.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            betAmount: true,
            winAmount: true,
            multiplier: true,
            isBonusRound: true,
            isJackpot: true,
            jackpotTier: true,
            serverSeedHash: true,
            serverSeed: true,
            clientSeed: true,
            nonce: true,
            createdAt: true,
          },
        }),
        server.prisma.spin.count({ where: { userId } }),
      ]);

      return reply.send({ spins, total, page, limit });
    }
  );

  // ── GET /api/v1/game/configs ──────────────────────────────────────────────
  server.get("/configs", async (_req, reply) => {
    const configs = await server.prisma.gameConfig.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        rtp: true,
        volatility: true,
        minBet: true,
        maxBet: true,
      },
    });
    return reply.send({ configs });
  });
}

async function contributeToJackpots(
  server: FastifyInstance,
  betAmount: number
) {
  const pools = await server.prisma.jackpotPool.findMany();
  for (const pool of pools) {
    const contribution = betAmount * pool.contributionPct;
    // Use Redis atomic increment for distributed safety
    await server.redis.incrbyfloat(
      `jackpot:${pool.tier}`,
      contribution
    );
  }
}
