"""
ScatterX AI Reward Engine
FastAPI service for player scoring and personalized reward generation.
"""
import os
import logging
from contextlib import asynccontextmanager
from typing import Optional

import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException, Security, Depends
from fastapi.security.api_key import APIKeyHeader
from prometheus_fastapi_instrumentator import Instrumentator
from pydantic import BaseModel, Field

from app.scorer import PlayerScorer
from app.reward_generator import RewardGenerator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

API_KEY = os.getenv("AI_ENGINE_API_KEY", "")
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

scorer: Optional[PlayerScorer] = None
reward_gen: Optional[RewardGenerator] = None
redis_client: Optional[aioredis.Redis] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global scorer, reward_gen, redis_client

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    redis_client = aioredis.from_url(redis_url, decode_responses=True)
    await redis_client.ping()
    logger.info("Connected to Redis")

    scorer = PlayerScorer()
    reward_gen = RewardGenerator()
    logger.info("🧠 AI models loaded")

    yield

    if redis_client:
        await redis_client.aclose()


app = FastAPI(
    title="ScatterX AI Reward Engine",
    version="1.0.0",
    description="ML-powered player scoring and personalized rewards",
    lifespan=lifespan,
)

Instrumentator().instrument(app).expose(app)


def verify_api_key(key: str = Security(api_key_header)) -> str:
    if not API_KEY:
        return key  # Unauthenticated in dev
    if key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return key


# ── Request / Response models ─────────────────────────────────────────────────

class PlayerFeatures(BaseModel):
    player_id: str
    days_since_registration: int = Field(ge=0)
    total_deposits: float = Field(ge=0)
    total_bets: float = Field(ge=0)
    total_wins: float = Field(ge=0)
    session_count_7d: int = Field(ge=0)
    session_count_30d: int = Field(ge=0)
    avg_bet_size: float = Field(ge=0)
    days_since_last_session: int = Field(ge=0)
    vip_level: int = Field(ge=0, le=10)
    has_affiliate_code: bool = False
    preferred_game: Optional[str] = None
    region: Optional[str] = None


class PlayerScores(BaseModel):
    player_id: str
    churn_risk: float = Field(ge=0, le=1)
    retention_score: float = Field(ge=0, le=1)
    reward_affinity: dict
    spending_momentum: float = Field(ge=0, le=1)
    vip_potential: float = Field(ge=0, le=1)
    fraud_probability: float = Field(ge=0, le=1)
    model_version: str


class RewardSuggestion(BaseModel):
    reward_type: str
    value: float
    reason: str
    confidence: float


class RecommendRequest(BaseModel):
    player_id: str
    scores: PlayerScores
    max_rewards: int = Field(default=3, ge=1, le=10)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    redis_ok = False
    try:
        if redis_client:
            await redis_client.ping()
            redis_ok = True
    except Exception:
        pass
    return {"status": "ok" if redis_ok else "degraded", "redis": redis_ok}


@app.post("/score", response_model=PlayerScores, dependencies=[Depends(verify_api_key)])
async def score_player(features: PlayerFeatures):
    """Score a player across multiple ML dimensions."""
    if scorer is None:
        raise HTTPException(status_code=503, detail="Scorer not ready")

    scores = scorer.score(features.model_dump())

    # Cache scores in Redis (TTL 1 hour)
    if redis_client:
        cache_key = f"ai:scores:{features.player_id}"
        await redis_client.setex(cache_key, 3600, str(scores))

    return PlayerScores(
        player_id=features.player_id,
        **scores,
    )


@app.post("/recommend", response_model=list[RewardSuggestion], dependencies=[Depends(verify_api_key)])
async def recommend_rewards(req: RecommendRequest):
    """Generate personalized reward suggestions based on player scores."""
    if reward_gen is None:
        raise HTTPException(status_code=503, detail="Reward generator not ready")

    suggestions = reward_gen.generate(req.scores.model_dump(), req.max_rewards)
    return suggestions


@app.get("/scores/{player_id}", dependencies=[Depends(verify_api_key)])
async def get_cached_scores(player_id: str):
    """Retrieve cached player scores from Redis."""
    if not redis_client:
        raise HTTPException(status_code=503, detail="Redis unavailable")

    cache_key = f"ai:scores:{player_id}"
    cached = await redis_client.get(cache_key)
    if not cached:
        raise HTTPException(status_code=404, detail="No cached scores found")

    return {"player_id": player_id, "cached_scores": cached}
