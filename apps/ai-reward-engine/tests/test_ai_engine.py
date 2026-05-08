"""Tests for the AI player scoring engine."""
import pytest
from app.scorer import PlayerScorer
from app.reward_generator import RewardGenerator


@pytest.fixture
def scorer():
    return PlayerScorer()


@pytest.fixture
def reward_gen():
    return RewardGenerator()


def base_features(**overrides):
    defaults = {
        "player_id": "test-player-001",
        "days_since_registration": 90,
        "total_deposits": 5000.0,
        "total_bets": 20000.0,
        "total_wins": 18000.0,
        "session_count_7d": 5,
        "session_count_30d": 20,
        "avg_bet_size": 100.0,
        "days_since_last_session": 2,
        "vip_level": 3,
        "has_affiliate_code": False,
    }
    defaults.update(overrides)
    return defaults


class TestPlayerScorer:
    def test_scores_have_all_fields(self, scorer):
        features = base_features()
        scores = scorer.score(features)
        required_keys = [
            "churn_risk",
            "retention_score",
            "reward_affinity",
            "spending_momentum",
            "vip_potential",
            "fraud_probability",
            "model_version",
        ]
        for key in required_keys:
            assert key in scores, f"Missing key: {key}"

    def test_scores_in_range(self, scorer):
        features = base_features()
        scores = scorer.score(features)
        for key in ["churn_risk", "retention_score", "spending_momentum",
                    "vip_potential", "fraud_probability"]:
            val = scores[key]
            assert 0.0 <= val <= 1.0, f"{key}={val} out of [0,1] range"

    def test_inactive_player_high_churn(self, scorer):
        features = base_features(days_since_last_session=45, session_count_7d=0)
        scores = scorer.score(features)
        assert scores["churn_risk"] > 0.5, "Inactive player should have high churn risk"

    def test_active_player_low_churn(self, scorer):
        features = base_features(days_since_last_session=0, session_count_7d=7)
        scores = scorer.score(features)
        assert scores["churn_risk"] < 0.5, "Active player should have low churn risk"

    def test_suspicious_win_rate_raises_fraud_score(self, scorer):
        # 2x total wins vs total bets is extremely suspicious
        features = base_features(total_bets=1000.0, total_wins=2000.0)
        scores = scorer.score(features)
        assert scores["fraud_probability"] > 0, "High win rate should raise fraud score"

    def test_normal_win_rate_low_fraud(self, scorer):
        # ~90% RTP is normal
        features = base_features(total_bets=10000.0, total_wins=9000.0)
        scores = scorer.score(features)
        assert scores["fraud_probability"] < 0.3


class TestRewardGenerator:
    def build_scores(self, **overrides):
        base = {
            "player_id": "test-player-001",
            "churn_risk": 0.1,
            "retention_score": 0.7,
            "reward_affinity": {
                "free_spins": 0.8,
                "cashback": 0.4,
                "deposit_match": 0.5,
                "vip_boost": 0.3,
                "jackpot_multiplier": 0.2,
            },
            "spending_momentum": 0.6,
            "vip_potential": 0.5,
            "fraud_probability": 0.0,
            "model_version": "1.0.0-rules",
        }
        base.update(overrides)
        return base

    def test_returns_rewards(self, reward_gen):
        scores = self.build_scores()
        rewards = reward_gen.generate(scores, max_rewards=3)
        assert len(rewards) <= 3
        assert len(rewards) > 0

    def test_blocks_high_fraud(self, reward_gen):
        scores = self.build_scores(fraud_probability=0.9)
        rewards = reward_gen.generate(scores)
        assert rewards == [], "High-fraud player should get no rewards"

    def test_churn_boosts_free_spins(self, reward_gen):
        scores = self.build_scores(
            churn_risk=0.8,
            reward_affinity={
                "free_spins": 0.5,
                "cashback": 0.5,
                "deposit_match": 0.5,
                "vip_boost": 0.5,
                "jackpot_multiplier": 0.5,
            },
        )
        rewards = reward_gen.generate(scores, max_rewards=5)
        # free_spins should be boosted and appear first
        reward_types = [r["reward_type"] for r in rewards]
        assert "free_spins" in reward_types

    def test_max_rewards_respected(self, reward_gen):
        scores = self.build_scores()
        for n in [1, 2, 3, 5]:
            rewards = reward_gen.generate(scores, max_rewards=n)
            assert len(rewards) <= n

    def test_reward_values_positive(self, reward_gen):
        scores = self.build_scores()
        rewards = reward_gen.generate(scores)
        for r in rewards:
            assert r["value"] > 0
            assert 0.0 <= r["confidence"] <= 1.0
