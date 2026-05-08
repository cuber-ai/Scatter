# ScatterX Enterprise 🎰

**Philippines-optimized slot gaming platform** — provably fair, AI-powered, enterprise-grade.

[![CI](https://github.com/cuber-ai/Scatter/actions/workflows/ci.yml/badge.svg)](https://github.com/cuber-ai/Scatter/actions/workflows/ci.yml)

---

## Architecture

ScatterX Enterprise is a cross-runtime monorepo:

```
Frontend (React 19 + Next.js 15 + TSX)
       │
       ▼
API Gateway (Fastify + Prisma + TypeScript)
       │
       ├── Game Server (Rust – deterministic RNG, anti-exploit)
       ├── Jackpot Service (Go – atomic Redis increments)
       ├── AI Reward Engine (Python FastAPI – ML scoring)
       ├── Payment Worker (Node.js + BullMQ)
       └── Realtime Gateway (Socket.IO – WebSocket events)
       │
       ├── PostgreSQL (Prisma schema)
       └── Redis (jackpot pools, sessions, pub/sub)
```

### Runtime Allocation

| Runtime | Responsibility |
|---------|---------------|
| **Rust** | Deterministic game math, RNG, anti-exploit, provably fair |
| **Go** | Jackpot orchestration, atomic Redis increments, distributed locking |
| **Python** | AI reward scoring, churn prediction, fraud ML models |
| **TypeScript/Node.js** | API gateway, auth, wallets, Prisma ORM, BullMQ |
| **React/Next.js** | Web frontend + Admin dashboard |

---

## Monorepo Structure

```
/apps
  /web               Next.js 15 + React 19 player frontend
  /api               Fastify API gateway (TypeScript)
  /game-server       Rust deterministic slot engine
  /jackpot-service   Go jackpot orchestration microservice
  /ai-reward-engine  Python FastAPI ML reward engine
  /payment-worker    Node.js BullMQ payment processor
  /realtime-gateway  Socket.IO realtime event gateway
  /admin-enterprise  Next.js 15 admin dashboard

/packages
  /security-core     TypeScript security utilities (auth, CSRF, fraud scoring)
  /ui                Shared React components

/infrastructure
  /k8s               Kubernetes manifests + HPA
  /terraform         Cloud infrastructure

/docker              Dockerfiles per runtime
/.github/workflows   CI (lint/test) + CD (build/deploy)
```

---

## Security Model

> **IMPORTANT: No credentials are hardcoded in source code.**
> All secrets are managed via environment variables.

### First-Time Setup

1. Copy `.env.example` to `.env`
2. Set **all** secrets, especially `JWT_SECRET` and `JWT_REFRESH_SECRET`
3. Set `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` for initial seeding
4. Run `pnpm db:seed` — this:
   - Validates password strength (min 12 chars)
   - Hashes with Argon2id (memory-hard, 64MB cost)
   - Sets `passwordChangedAt: null` → rotation enforced on first login

### Security Features

- **JWT + Refresh Tokens** — 15-minute access tokens, 7-day refresh tokens
- **Argon2id** — Password hashing (GPU-resistant)
- **CSRF Protection** — Double-submit cookie pattern
- **Rate Limiting** — Per-endpoint limits (5 registrations/15min, 60 spins/min)
- **RBAC** — PLAYER / VIP / AFFILIATE / MODERATOR / ADMIN / SUPER_ADMIN
- **Immutable Audit Logs** — All admin and player actions recorded
- **Anti-Replay** — server_seed + client_seed + nonce uniqueness enforced
- **Provably Fair** — SHA-256 commitment before spin, seed revealed after
- **Distributed Locking** — Redis SETNX for jackpot payout safety
- **CSP Headers** — Content-Security-Policy on all responses

---

## Local Development

### Prerequisites

- Node.js 20+, pnpm 9+
- Rust 1.83+ (for game-server)
- Go 1.22+ (for jackpot-service)
- Python 3.12+ (for ai-reward-engine)
- Docker + Docker Compose

### Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env — fill in secrets

# 3. Start PostgreSQL + Redis
cd docker && docker compose up -d postgres redis

# 4. Migrate database and seed
pnpm db:migrate
pnpm db:seed

# 5. Start all services in dev mode
pnpm dev
```

### Service Ports

| Service            | Port |
|--------------------|------|
| Web Frontend       | 3000 |
| API Gateway        | 3001 |
| Realtime Gateway   | 3002 |
| Admin Dashboard    | 3003 |
| AI Reward Engine   | 8000 |
| Jackpot Service    | 9000 |
| Game Server        | 9001 |
| Prometheus         | 9090 |
| Grafana            | 3004 |

---

## Game Engine (Rust)

Deterministic ChaCha20 PRNG seeded from HMAC-SHA256:

```
seed = HMAC-SHA256(server_seed, "{client_seed}:{nonce}")
grid = ChaCha20(seed) → 5×3 symbol matrix
```

**Provably fair flow:**
1. Before spin: server commits `SHA256(server_seed)` to client
2. Player supplies `client_seed` + `nonce`
3. After spin: server reveals `server_seed`
4. Any party can independently verify the result

---

## Jackpot System (Go)

| Tier | Base Amount | Bet Contribution |
|------|-------------|-----------------|
| MINI | ₱1,000 | 0.5% |
| MAJOR | ₱50,000 | 0.8% |
| MEGA | ₱500,000 | 1.2% |
| PROGRESSIVE | ₱1,000,000 | 2.0% |

Uses Redis `INCRBYFLOAT` (atomic) for contributions and `SETNX` distributed lock for payout.

---

## AI Reward Engine (Python)

Scores players on 6 dimensions then generates personalized rewards:

| Signal | Description |
|--------|-------------|
| `churn_risk` | Inactivity probability |
| `retention_score` | Engagement health |
| `reward_affinity` | Per-reward-type preference weights |
| `spending_momentum` | Recent vs historical spend ratio |
| `vip_potential` | High-value player likelihood |
| `fraud_probability` | Anomaly detection |

Players with `fraud_probability > 0.7` receive no rewards.

---

## Testing

```bash
# TypeScript / Node.js
pnpm test

# Rust game engine (determinism, edge cases)
cd apps/game-server && cargo test

# Go jackpot service
cd apps/jackpot-service && go test ./...

# Python AI engine
cd apps/ai-reward-engine && pytest tests/ -v
```

---

## Deployment

### Docker Compose

```bash
cd docker && docker compose up -d
```

### Kubernetes

```bash
# Create secrets — never commit these
kubectl create secret generic scatterx-secrets \
  --from-literal=database-url="postgresql://..." \
  --from-literal=redis-url="redis://..." \
  --from-literal=jwt-secret="$(openssl rand -base64 64)" \
  --from-literal=jwt-refresh-secret="$(openssl rand -base64 64)"

kubectl apply -f infrastructure/k8s/
```

### Phased Rollout

| Phase | Scope |
|-------|-------|
| 1% | Closed beta, sandbox payments, feature flags |
| 25% | Luzon / Visayas / Mindanao regional balancing |
| 50% | Nationwide launch, affiliate onboarding |
| 100% | Full autoscaling, CDN, multi-region failover |

---

## License

Boost Software License 1.0 — see [LICENSE](LICENSE)
