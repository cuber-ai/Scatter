FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY packages/*/package.json ./packages/*/
RUN pnpm install --frozen-lockfile --filter @scatterx/api...

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api/ ./apps/api/
COPY packages/ ./packages/
RUN pnpm --filter @scatterx/api run build && \
    pnpm --filter @scatterx/api exec prisma generate

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -S scatterx && adduser -S scatterx -G scatterx
COPY --from=builder --chown=scatterx:scatterx /app/apps/api/dist ./dist
COPY --from=builder --chown=scatterx:scatterx /app/apps/api/node_modules ./node_modules
COPY --from=builder --chown=scatterx:scatterx /app/apps/api/prisma ./prisma
USER scatterx
EXPOSE 3001
CMD ["node", "dist/server.js"]
