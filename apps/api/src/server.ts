import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { authRoutes } from "./routes/auth.js";
import { playerRoutes } from "./routes/players.js";
import { gameRoutes } from "./routes/game.js";
import { jackpotRoutes } from "./routes/jackpot.js";
import { walletRoutes } from "./routes/wallet.js";
import { affiliateRoutes } from "./routes/affiliate.js";
import { adminRoutes } from "./routes/admin.js";
import { rewardRoutes } from "./routes/rewards.js";
import { healthRoutes } from "./routes/health.js";
import { prismaPlugin } from "./plugins/prisma.js";
import { redisPlugin } from "./plugins/redis.js";

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty" }
        : undefined,
  },
  trustProxy: true,
});

async function bootstrap() {
  // ── Security headers ───────────────────────────────────────────────────────
  await server.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  await server.register(fastifyCors, {
    origin: process.env.APP_URL ?? "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────
  await server.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Rate limit exceeded. Try again in ${context.after}.`,
    }),
  });

  // ── Authentication ────────────────────────────────────────────────────────
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret === "CHANGE_ME_IN_PRODUCTION") {
    throw new Error(
      "JWT_SECRET must be set to a secure value in environment variables."
    );
  }

  await server.register(fastifyJwt, {
    secret: jwtSecret,
    cookie: { cookieName: "access_token", signed: false },
  });

  await server.register(fastifyCookie);

  // ── Database + Cache ──────────────────────────────────────────────────────
  await server.register(prismaPlugin);
  await server.register(redisPlugin);

  // ── OpenAPI / Swagger ─────────────────────────────────────────────────────
  await server.register(fastifySwagger, {
    openapi: {
      info: {
        title: "ScatterX Enterprise API",
        version: "1.0.0",
        description: "ScatterX Enterprise REST API documentation",
      },
      servers: [{ url: process.env.APP_URL ?? "http://localhost:3001" }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });

  await server.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list" },
  });

  // ── Routes ────────────────────────────────────────────────────────────────
  await server.register(healthRoutes, { prefix: "/health" });
  await server.register(authRoutes, { prefix: "/api/v1/auth" });
  await server.register(playerRoutes, { prefix: "/api/v1/players" });
  await server.register(gameRoutes, { prefix: "/api/v1/game" });
  await server.register(jackpotRoutes, { prefix: "/api/v1/jackpot" });
  await server.register(walletRoutes, { prefix: "/api/v1/wallet" });
  await server.register(affiliateRoutes, { prefix: "/api/v1/affiliate" });
  await server.register(rewardRoutes, { prefix: "/api/v1/rewards" });
  await server.register(adminRoutes, { prefix: "/api/v1/admin" });

  return server;
}

async function start() {
  try {
    const app = await bootstrap();
    const port = Number(process.env.APP_PORT ?? 3001);
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`🚀 ScatterX API running on port ${port}`);
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

start();
