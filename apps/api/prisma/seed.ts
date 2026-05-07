import { PrismaClient, Role, JackpotTier, WalletType } from "@prisma/client";
import { hash } from "argon2";

const prisma = new PrismaClient();

async function main() {
  // ── Guard: require explicit env var for seed ──────────────────────────────
  const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      "ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD must be set in environment variables.\n" +
        "Never hardcode credentials. See .env.example for guidance."
    );
  }

  if (adminPassword.length < 12) {
    throw new Error(
      "ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters."
    );
  }

  console.log("🌱 Seeding ScatterX Enterprise database...");

  // ── Create super-admin ────────────────────────────────────────────────────
  const passwordHash = await hash(adminPassword, {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      username: "superadmin",
      passwordHash,
      role: Role.SUPER_ADMIN,
      isActive: true,
      // Force password rotation on first login
      passwordChangedAt: null,
      locale: "en",
      timezone: "Asia/Manila",
    },
  });

  console.log(`✅ Super-admin created: ${admin.email} (id: ${admin.id})`);
  console.log(
    "⚠️  Password rotation will be enforced on first login (passwordChangedAt is null)."
  );

  // ── Create wallets for admin ───────────────────────────────────────────────
  for (const type of [WalletType.MAIN, WalletType.BONUS]) {
    await prisma.wallet.upsert({
      where: {
        userId_type_currency: {
          userId: admin.id,
          type,
          currency: "PHP",
        },
      },
      update: {},
      create: {
        userId: admin.id,
        type,
        balance: 0,
        currency: "PHP",
      },
    });
  }

  // ── Seed jackpot pools ────────────────────────────────────────────────────
  const jackpotDefaults: Array<{
    tier: JackpotTier;
    baseAmount: number;
    contributionPct: number;
  }> = [
    { tier: JackpotTier.MINI, baseAmount: 1000, contributionPct: 0.005 },
    { tier: JackpotTier.MAJOR, baseAmount: 50000, contributionPct: 0.008 },
    { tier: JackpotTier.MEGA, baseAmount: 500000, contributionPct: 0.012 },
    {
      tier: JackpotTier.PROGRESSIVE,
      baseAmount: 1000000,
      contributionPct: 0.02,
    },
  ];

  for (const jp of jackpotDefaults) {
    await prisma.jackpotPool.upsert({
      where: { tier: jp.tier },
      update: {},
      create: {
        tier: jp.tier,
        currentAmount: jp.baseAmount,
        baseAmount: jp.baseAmount,
        contributionPct: jp.contributionPct,
        currency: "PHP",
      },
    });
    console.log(`✅ Jackpot pool seeded: ${jp.tier}`);
  }

  // ── Seed default game config ──────────────────────────────────────────────
  await prisma.gameConfig.upsert({
    where: { name: "scatter-classic" },
    update: {},
    create: {
      name: "scatter-classic",
      rtp: 96.0,
      volatility: "medium",
      symbolWeights: {
        wild: 1,
        scatter: 2,
        seven: 5,
        bar: 8,
        bell: 10,
        cherry: 15,
        lemon: 20,
        orange: 20,
        plum: 19,
      },
      paylines: [
        [0, 1, 2, 3, 4],
        [5, 6, 7, 8, 9],
        [10, 11, 12, 13, 14],
        [0, 6, 12, 8, 4],
        [10, 6, 2, 8, 14],
      ],
      minBet: 1.0,
      maxBet: 50000.0,
      isActive: true,
    },
  });
  console.log("✅ Default game config seeded: scatter-classic");

  // ── Seed default reward campaign ──────────────────────────────────────────
  const now = new Date();
  const oneYearLater = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  await prisma.rewardCampaign.upsert({
    where: { id: "welcome-bonus-campaign" },
    update: {},
    create: {
      id: "welcome-bonus-campaign",
      name: "Welcome Bonus",
      description: "100% deposit match up to ₱5,000 for new players",
      rewardType: "DEPOSIT_MATCH",
      value: 5000,
      conditions: { minDeposit: 100, maxBonus: 5000, matchPct: 100 },
      startAt: now,
      endAt: oneYearLater,
      budget: 10000000,
      isActive: true,
    },
  });
  console.log("✅ Welcome bonus campaign seeded");

  console.log("\n🎉 Seed complete!");
  console.log(
    "🔐 IMPORTANT: Change the admin password immediately after first login."
  );
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
