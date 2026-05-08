export interface FraudSignals {
  userId: string;
  ipAddress: string;
  userAgent: string;
  deviceFingerprint?: string;
  isVpn?: boolean;
  isProxy?: boolean;
  winRate?: number;       // total_wins / total_bets
  rapidSpinCount?: number; // spins per minute
  multipleAccountSameIp?: boolean;
}

export interface FraudScore {
  score: number;          // 0.0 – 1.0
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  flags: string[];
  action: "ALLOW" | "MONITOR" | "CAPTCHA" | "QUARANTINE" | "BAN";
}

export class FraudScorer {
  score(signals: FraudSignals): FraudScore {
    let score = 0;
    const flags: string[] = [];

    if (signals.isVpn) {
      score += 0.2;
      flags.push("VPN_DETECTED");
    }

    if (signals.isProxy) {
      score += 0.25;
      flags.push("PROXY_DETECTED");
    }

    if (signals.winRate !== undefined && signals.winRate > 0.5) {
      score += Math.min(0.4, (signals.winRate - 0.5) * 2);
      flags.push("ABNORMAL_WIN_RATE");
    }

    if (signals.rapidSpinCount !== undefined && signals.rapidSpinCount > 100) {
      score += 0.3;
      flags.push("RAPID_SPIN_DETECTED");
    }

    if (signals.multipleAccountSameIp) {
      score += 0.35;
      flags.push("MULTI_ACCOUNT_SAME_IP");
    }

    score = Math.min(1.0, score);

    let risk: FraudScore["risk"];
    let action: FraudScore["action"];

    if (score < 0.2) {
      risk = "LOW";
      action = "ALLOW";
    } else if (score < 0.4) {
      risk = "MEDIUM";
      action = "MONITOR";
    } else if (score < 0.6) {
      risk = "HIGH";
      action = "CAPTCHA";
    } else if (score < 0.8) {
      risk = "CRITICAL";
      action = "QUARANTINE";
    } else {
      risk = "CRITICAL";
      action = "BAN";
    }

    return { score, risk, flags, action };
  }
}
