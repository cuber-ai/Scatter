import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import { Server as SocketServer } from "socket.io";
import { createServer } from "http";
import Redis from "ioredis";
import jwt from "jsonwebtoken";

const fastify = Fastify({ logger: true });
const httpServer = createServer(fastify.server);

const redisPub = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const redisSub = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

const io = new SocketServer(httpServer, {
  cors: {
    origin: process.env.SOCKET_IO_CORS_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  console.error("JWT_SECRET environment variable is required");
  process.exit(1);
}

// ── JWT Auth middleware ───────────────────────────────────────────────────────
io.use((socket, next) => {
  const token =
    (socket.handshake.auth?.token as string) ||
    (socket.handshake.headers?.authorization?.replace("Bearer ", "") ?? "");

  if (!token) {
    return next(new Error("Authentication required"));
  }

  try {
    // Verify the full JWT signature – rejects tampered or expired tokens.
    const payload = jwt.verify(token, jwtSecret) as jwt.JwtPayload & {
      sub: string;
      role: string;
    };
    socket.data.userId = payload.sub;
    socket.data.role = payload.role;
    next();
  } catch {
    return next(new Error("Invalid or expired token"));
  }
});

// ── Connection handlers ───────────────────────────────────────────────────────
io.on("connection", (socket) => {
  const { userId, role } = socket.data as { userId: string; role: string };
  fastify.log.info({ userId }, "Socket connected");

  // Join user-specific room
  socket.join(`user:${userId}`);

  // Admins join admin room
  if (["ADMIN", "SUPER_ADMIN", "MODERATOR"].includes(role)) {
    socket.join("admin");
  }

  // Rate limit: max 2 messages/sec from client.
  // Store the handle so it can be cleared when the socket disconnects.
  let msgCount = 0;
  const rateLimitInterval = setInterval(() => {
    msgCount = 0;
  }, 1000);

  socket.on("disconnect", () => {
    clearInterval(rateLimitInterval);
    fastify.log.info({ userId }, "Socket disconnected");
  });

  socket.onAny((_event) => {
    msgCount++;
    if (msgCount > 2) {
      socket.emit("error", { message: "Rate limit exceeded" });
      socket.disconnect(true);
    }
  });
});

// ── Redis pub/sub for cross-service events ────────────────────────────────────
const CHANNELS = [
  "jackpot:win",
  "jackpot:update",
  "spin:result",
  "reward:granted",
  "payment:confirmed",
  "fraud:alert",
];

redisSub.subscribe(...CHANNELS, (err) => {
  if (err) fastify.log.error({ err }, "Redis subscribe failed");
  else fastify.log.info({ channels: CHANNELS }, "Subscribed to Redis channels");
});

redisSub.on("message", (channel, message) => {
  try {
    const data = JSON.parse(message) as {
      userId?: string;
      broadcast?: boolean;
      [key: string]: unknown;
    };

    if (channel === "jackpot:update") {
      // Broadcast jackpot updates to all connected clients
      io.emit("jackpot:update", data);
    } else if (data.userId) {
      // Route to specific user
      io.to(`user:${data.userId}`).emit(channel, data);
    } else if (data.broadcast) {
      io.emit(channel, data);
    }
  } catch (e) {
    fastify.log.error({ e, channel }, "Failed to parse Redis message");
  }
});

// ── HTTP routes ───────────────────────────────────────────────────────────────
fastify.register(fastifyCors, {
  origin: process.env.SOCKET_IO_CORS_ORIGIN ?? "http://localhost:3000",
});

fastify.get("/health", async () => ({
  status: "ok",
  service: "realtime-gateway",
  connections: io.engine.clientsCount,
}));

// ── Start server ──────────────────────────────────────────────────────────────
const port = Number(process.env.SOCKET_IO_PORT ?? 3002);
httpServer.listen(port, "0.0.0.0", () => {
  fastify.log.info(`⚡ Realtime gateway running on port ${port}`);
});

export { io, redisPub };
