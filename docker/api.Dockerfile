FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

FROM base AS deps
# pnpm-workspace.yaml is required for workspace-aware installs/deploys
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/security-core/package.json ./packages/security-core/
RUN pnpm install --frozen-lockfile --filter @scatterx/api...

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/ ./apps/api/
COPY packages/ ./packages/
RUN pnpm --filter @scatterx/api run build && \
    pnpm --filter @scatterx/api exec prisma generate && \
    # pnpm deploy resolves workspace symlinks into a self-contained prod bundle
    pnpm deploy --filter @scatterx/api --prod /app/prod-deploy

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -S scatterx && adduser -S scatterx -G scatterx
# prod-deploy contains node_modules with all workspace deps properly resolved
COPY --from=builder --chown=scatterx:scatterx /app/prod-deploy ./
# dist and prisma were built in the builder stage; copy them into prod-deploy root
COPY --from=builder --chown=scatterx:scatterx /app/apps/api/dist ./dist
COPY --from=builder --chown=scatterx:scatterx /app/apps/api/prisma ./prisma
USER scatterx
EXPOSE 3001
CMD ["node", "dist/server.js"]
