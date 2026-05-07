"""
Player scoring engine using rule-based heuristics with hooks for ML model loading.
In production, replace the heuristics with loaded scikit-learn / TensorFlow models.
"""
import logging
from typing import Any

logger = logging.getLogger(__name__)

MODEL_VERSION = "1.0.0-rules"


class PlayerScorer:
    """
    Scores players across multiple behavioral dimensions.
    Production: swap `_score_*` methods with loaded ML model inference.
    """

    def __init__(self):
        logger.info("PlayerScorer initialized (rules engine v%s)", MODEL_VERSION)

    def score(self, features: dict[str, Any]) -> dict[str, Any]:
        return {
            "churn_risk": self._score_churn_risk(features),
            "retention_score": self._score_retention(features),
            "reward_affinity": self._score_reward_affinity(features),
            "spending_momentum": self._score_spending_momentum(features),
            "vip_potential": self._score_vip_potential(features),
            "fraud_probability": self._score_fraud(features),
            "model_version": MODEL_VERSION,
        }

    def _score_churn_risk(self, f: dict) -> float:
        """High churn risk if inactive for many days and low session count."""
        days_inactive = f.get("days_since_last_session", 0)
        sessions_7d = f.get("session_count_7d", 0)
        risk = min(1.0, days_inactive / 30.0) * 0.6
        risk += max(0.0, (5 - sessions_7d) / 5.0) * 0.4
        return round(min(1.0, risk), 4)

    def _score_retention(self, f: dict) -> float:
        """High retention if active sessions + positive deposit history."""
        sessions_30d = f.get("session_count_30d", 0)
        days_registered = f.get("days_since_registration", 0)
        total_deposits = f.get("total_deposits", 0)
        score = min(1.0, sessions_30d / 30.0) * 0.5
        score += min(1.0, total_deposits / 10000.0) * 0.3
        score += min(1.0, days_registered / 365.0) * 0.2
        return round(score, 4)

    def _score_reward_affinity(self, f: dict) -> dict[str, float]:
        """Estimate which reward types the player is most likely to respond to."""
        avg_bet = f.get("avg_bet_size", 0)
        vip = f.get("vip_level", 0)
        churn = self._score_churn_risk(f)

        return {
            "free_spins": round(min(1.0, 0.5 + churn * 0.5), 4),
            "cashback": round(min(1.0, avg_bet / 1000.0 * 0.6), 4),
            "deposit_match": round(min(1.0, 0.3 + (1.0 - churn) * 0.4), 4),
            "vip_boost": round(min(1.0, vip / 10.0 * 0.8), 4),
            "jackpot_multiplier": round(min(1.0, avg_bet / 5000.0), 4),
        }

    def _score_spending_momentum(self, f: dict) -> float:
        """Ratio of recent to historical spending."""
        total_bets = f.get("total_bets", 0)
        avg_bet = f.get("avg_bet_size", 0)
        sessions_7d = f.get("session_count_7d", 0)
        if total_bets == 0:
            return 0.0
        recent_proxy = avg_bet * sessions_7d
        momentum = min(1.0, recent_proxy / (total_bets / max(1, f.get("days_since_registration", 30)) * 7))
        return round(momentum, 4)

    def _score_vip_potential(self, f: dict) -> float:
        """VIP potential based on deposits, bet size, and tenure."""
        total_deposits = f.get("total_deposits", 0)
        avg_bet = f.get("avg_bet_size", 0)
        potential = min(1.0, total_deposits / 50000.0) * 0.5
        potential += min(1.0, avg_bet / 5000.0) * 0.5
        return round(potential, 4)

    def _score_fraud(self, f: dict) -> float:
        """Heuristic fraud probability – low by default, flag outliers.

        Normal slot play: total_wins ≈ total_bets * RTP (e.g. 0.96).
        Exploitation signals: total_wins consistently > total_bets (win_rate > 1.0).
        """
        total_bets = f.get("total_bets", 0)
        total_wins = f.get("total_wins", 0)
        if total_bets <= 0:
            return 0.0
        win_rate = total_wins / total_bets
        # Only flag when player is winning MORE than they bet (net positive)
        # Threshold: 1.1x = mild suspicion, 2x+ = critical
        if win_rate <= 1.1:
            return 0.0
        fraud = min(1.0, (win_rate - 1.1) * 0.9)
        return round(fraud, 4)
