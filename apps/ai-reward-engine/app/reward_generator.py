"""
Reward recommendation engine.
Generates personalized reward suggestions based on player scores.
"""
import logging
from typing import Any

logger = logging.getLogger(__name__)


REWARD_CATALOG = [
    {
        "reward_type": "free_spins",
        "affinity_key": "free_spins",
        "base_value": 10,
        "churn_boost": True,
        "description": "Free spins to re-engage player",
    },
    {
        "reward_type": "cashback",
        "affinity_key": "cashback",
        "base_value": 500,
        "churn_boost": False,
        "description": "Cashback on recent losses",
    },
    {
        "reward_type": "deposit_match",
        "affinity_key": "deposit_match",
        "base_value": 2000,
        "churn_boost": False,
        "description": "100% deposit match up to value",
    },
    {
        "reward_type": "vip_boost",
        "affinity_key": "vip_boost",
        "base_value": 1,
        "churn_boost": False,
        "description": "VIP level boost",
    },
    {
        "reward_type": "jackpot_multiplier",
        "affinity_key": "jackpot_multiplier",
        "base_value": 2,
        "churn_boost": False,
        "description": "Jackpot contribution multiplier",
    },
]


class RewardGenerator:
    """
    Generates ranked reward suggestions based on player AI scores.
    """

    def __init__(self):
        logger.info("RewardGenerator initialized")

    def generate(
        self, scores: dict[str, Any], max_rewards: int = 3
    ) -> list[dict[str, Any]]:
        churn_risk = scores.get("churn_risk", 0)
        fraud_prob = scores.get("fraud_probability", 0)
        affinity = scores.get("reward_affinity", {})

        # Block rewards for high-fraud-risk players
        if fraud_prob > 0.7:
            logger.warning("Reward blocked for high-fraud player: %s", scores.get("player_id"))
            return []

        ranked: list[dict] = []
        for reward in REWARD_CATALOG:
            aff_score = affinity.get(reward["affinity_key"], 0.0)

            # Boost score for churning players on retention-focused rewards
            if reward["churn_boost"] and churn_risk > 0.5:
                aff_score = min(1.0, aff_score + 0.3)

            # Scale value by affinity
            scaled_value = reward["base_value"] * (1 + aff_score)

            ranked.append({
                "reward_type": reward["reward_type"],
                "value": round(scaled_value, 2),
                "reason": reward["description"],
                "confidence": round(aff_score, 4),
            })

        # Sort by confidence descending, pick top N
        ranked.sort(key=lambda x: x["confidence"], reverse=True)
        return ranked[:max_rewards]
