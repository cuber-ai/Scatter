import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";

const DepositSchema = z.object({
  amount: z.number().positive().max(500000),
  provider: z.enum(["GCASH", "MAYA", "STRIPE", "PAYPAL", "CRYPTO"]),
  currency: z.string().default("PHP"),
});

const WithdrawSchema = z.object({
  amount: z.number().positive().max(100000),
  provider: z.enum(["GCASH", "MAYA", "STRIPE", "PAYPAL", "CRYPTO"]),
  accountDetails: z.object({
    accountNumber: z.string().optional(),
    email: z.string().email().optional(),
    walletId: z.string().optional(),
  }),
});

export async function walletRoutes(server: FastifyInstance) {
  // ── GET /api/v1/wallet/balance ────────────────────────────────────────────
  server.get(
    "/balance",
    { preHandler: [server.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req.user as { sub: string }).sub;

      const wallets = await server.prisma.wallet.findMany({
        where: { userId },
        select: { type: true, balance: true, currency: true },
      });

      return reply.send({ wallets });
    }
  );

  // ── POST /api/v1/wallet/deposit ────────────────────────────────────────────
  server.post(
    "/deposit",
    {
      preHandler: [server.authenticate],
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = DepositSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      const userId = (req.user as { sub: string }).sub;
      const { amount, provider, currency } = body.data;

      const idempotencyKey = `deposit-${userId}-${nanoid(16)}`;

      // Enqueue payment processing job
      const transaction = await server.prisma.transaction.create({
        data: {
          userId,
          walletId: await getMainWalletId(server, userId, currency),
          type: "DEPOSIT",
          status: "PENDING",
          amount,
          currency,
          provider,
          idempotencyKey,
          metadata: { initiatedFrom: req.ip },
        },
      });

      // In production: dispatch to payment-worker via BullMQ
      // await paymentQueue.add('process-deposit', { transactionId: transaction.id })

      return reply.status(202).send({
        transactionId: transaction.id,
        status: "PENDING",
        message: "Deposit initiated. Awaiting payment confirmation.",
      });
    }
  );

  // ── POST /api/v1/wallet/withdraw ───────────────────────────────────────────
  server.post(
    "/withdraw",
    {
      preHandler: [server.authenticate],
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = WithdrawSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      const userId = (req.user as { sub: string }).sub;
      const { amount, provider } = body.data;

      const wallet = await server.prisma.wallet.findFirst({
        where: { userId, type: "MAIN", currency: "PHP" },
      });

      if (!wallet || Number(wallet.balance) < amount) {
        return reply.status(402).send({ error: "Insufficient balance." });
      }

      const idempotencyKey = `withdraw-${userId}-${nanoid(16)}`;

      // Lock funds during processing
      await server.prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          lockedAmount: { increment: amount },
          balance: { decrement: amount },
        },
      });

      const transaction = await server.prisma.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: "WITHDRAWAL",
          status: "PENDING",
          amount,
          currency: "PHP",
          provider,
          idempotencyKey,
          metadata: { accountDetails: body.data.accountDetails },
        },
      });

      return reply.status(202).send({
        transactionId: transaction.id,
        status: "PENDING",
        message: "Withdrawal request submitted. Under review.",
      });
    }
  );

  // ── GET /api/v1/wallet/transactions ───────────────────────────────────────
  server.get(
    "/transactions",
    { preHandler: [server.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req.user as { sub: string }).sub;
      const query = req.query as {
        page?: string;
        limit?: string;
        type?: string;
      };
      const page = Math.max(1, Number(query.page ?? 1));
      const limit = Math.min(50, Number(query.limit ?? 20));

      const [txns, total] = await Promise.all([
        server.prisma.transaction.findMany({
          where: {
            userId,
            ...(query.type ? { type: query.type as "DEPOSIT" } : {}),
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            type: true,
            status: true,
            amount: true,
            currency: true,
            provider: true,
            createdAt: true,
            processedAt: true,
          },
        }),
        server.prisma.transaction.count({ where: { userId } }),
      ]);

      return reply.send({ transactions: txns, total, page, limit });
    }
  );
}

async function getMainWalletId(
  server: FastifyInstance,
  userId: string,
  currency: string
): Promise<string> {
  const wallet = await server.prisma.wallet.findFirst({
    where: { userId, type: "MAIN", currency },
  });
  if (!wallet) throw new Error("Main wallet not found.");
  return wallet.id;
}
