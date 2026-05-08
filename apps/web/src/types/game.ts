export interface SpinResult {
  spinId: string;
  reelResult: string[][];
  winAmount: number;
  multiplier: number;
  isBonusRound: boolean;
  isJackpot: boolean;
  jackpotTier: "MINI" | "MAJOR" | "MEGA" | "PROGRESSIVE" | null;
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

export interface JackpotPool {
  tier: "MINI" | "MAJOR" | "MEGA" | "PROGRESSIVE";
  currentAmount: number;
  baseAmount: number;
  currency: string;
  lastWonAt: string | null;
}

export interface GameConfig {
  id: string;
  name: string;
  rtp: number;
  volatility: string;
  minBet: number;
  maxBet: number;
}
