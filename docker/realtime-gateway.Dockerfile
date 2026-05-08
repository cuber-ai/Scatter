FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
# pnpm-workspace.yaml is required for workspace-aware installs/deploys
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY apps/realtime-gateway/package.json ./apps/realtime-gateway/
RUN pnpm install --frozen-lockfile --filter @scatterx/realtime-gateway

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/realtime-gateway/node_modules ./apps/realtime-gateway/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY apps/realtime-gateway/ ./apps/realtime-gateway/
RUN pnpm --filter @scatterx/realtime-gateway run build && \
    pnpm deploy --filter @scatterx/realtime-gateway --prod /app/prod-deploy

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -S scatterx && adduser -S scatterx -G scatterx
COPY --from=builder --chown=scatterx:scatterx /app/prod-deploy ./
COPY --from=builder --chown=scatterx:scatterx /app/apps/realtime-gateway/dist ./dist
USER scatterx
EXPOSE 3002
CMD ["node", "dist/gateway.js"]
