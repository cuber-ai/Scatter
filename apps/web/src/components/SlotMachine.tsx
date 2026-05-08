"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGameStore } from "@/store/gameStore";
import { apiClient } from "@/lib/api";
import type { SpinResult } from "@/types/game";

const SYMBOL_EMOJI: Record<string, string> = {
  wild: "🌟",
  scatter: "💎",
  seven: "7️⃣",
  bar: "🎰",
  bell: "🔔",
  cherry: "🍒",
  lemon: "🍋",
  orange: "🍊",
  plum: "🍇",
};

const REEL_COUNT = 5;
const ROW_COUNT = 3;

type Reel = string[][];

function generatePlaceholderReel(): Reel {
  const symbols = Object.keys(SYMBOL_EMOJI);
  return Array.from({ length: REEL_COUNT }, () =>
    Array.from({ length: ROW_COUNT }, () => symbols[Math.floor(Math.random() * symbols.length)])
  );
}

export default function SlotMachine() {
  const [reels, setReels] = useState<Reel>(generatePlaceholderReel());
  const [spinning, setSpinning] = useState(false);
  const [lastResult, setLastResult] = useState<SpinResult | null>(null);
  const [betAmount, setBetAmount] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const clientNonce = useRef(0);

  const { balance, setBalance, gameConfigId } = useGameStore();

  const spin = useCallback(async () => {
    if (spinning || balance < betAmount) return;
    setSpinning(true);
    setError(null);
    setLastResult(null);

    const clientSeed = Array.from(
      { length: 16 },
      () => Math.floor(Math.random() * 16).toString(16)
    ).join("");
    clientNonce.current += 1;

    try {
      // apiClient's response interceptor unwraps .data, so the resolved value
      // is already SpinResult – cast accordingly.
      const result = (await apiClient.post("/game/spin", {
        gameConfigId,
        betAmount,
        clientSeed,
        nonce: clientNonce.current,
      })) as unknown as SpinResult;

      setReels(result.reelResult as Reel);
      setLastResult(result);
      setBalance(balance - betAmount + result.winAmount);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Spin failed. Please try again.";
      setError(message);
    } finally {
      setSpinning(false);
    }
  }, [spinning, balance, betAmount, gameConfigId, setBalance]);

  const BET_OPTIONS = [1, 5, 10, 25, 50, 100, 500];

  return (
    <div className="flex flex-col items-center gap-6 p-4">
      {/* Balance */}
      <div className="glass px-6 py-3 flex items-center gap-3">
        <span className="text-gray-400 text-sm">Balance</span>
        <span className="text-2xl font-black text-amber-400">
          ₱{balance.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
        </span>
      </div>

      {/* Reels */}
      <div className="glass p-4 neon-glow-purple">
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${REEL_COUNT}, 1fr)` }}>
          {Array.from({ length: REEL_COUNT }, (_, reelIdx) => (
            <div key={reelIdx} className="flex flex-col gap-1">
              {Array.from({ length: ROW_COUNT }, (_, rowIdx) => {
                const symbol = reels[reelIdx]?.[rowIdx] ?? "cherry";
                return (
                  <motion.div
                    key={`${reelIdx}-${rowIdx}`}
                    className="reel-symbol glass"
                    animate={
                      spinning
                        ? { y: [0, -20, 0], opacity: [1, 0.5, 1] }
                        : {}
                    }
                    transition={{
                      duration: 0.2,
                      repeat: spinning ? Infinity : 0,
                      delay: reelIdx * 0.1,
                    }}
                  >
                    {SYMBOL_EMOJI[symbol] ?? "❓"}
                  </motion.div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Win announcement */}
      <AnimatePresence>
        {lastResult && lastResult.winAmount > 0 && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            className="glass p-4 text-center neon-glow-gold border-amber-500/30"
          >
            {lastResult.isJackpot ? (
              <p className="text-3xl font-black text-amber-400 neon-text">
                🏆 {lastResult.jackpotTier} JACKPOT!
              </p>
            ) : (
              <p className="text-2xl font-black text-green-400">
                WIN! ₱{lastResult.winAmount.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
              </p>
            )}
            <p className="text-sm text-gray-400 mt-1">
              {lastResult.multiplier.toFixed(1)}x multiplier
              {lastResult.isBonusRound && " · Bonus Round!"}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bet selector */}
      <div className="flex flex-wrap gap-2 justify-center">
        {BET_OPTIONS.map((amount) => (
          <button
            key={amount}
            onClick={() => setBetAmount(amount)}
            className={`px-3 py-1 rounded-lg text-sm font-bold transition-all ${
              betAmount === amount
                ? "bg-purple-600 text-white neon-glow-purple"
                : "glass text-gray-300 hover:bg-white/10"
            }`}
          >
            ₱{amount}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="text-red-400 text-sm glass px-4 py-2">{error}</p>
      )}

      {/* Spin button */}
      <button
        onClick={spin}
        disabled={spinning || balance < betAmount}
        className={`px-12 py-5 rounded-2xl text-2xl font-black transition-all ${
          spinning || balance < betAmount
            ? "opacity-50 cursor-not-allowed glass"
            : "bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 neon-glow-purple"
        }`}
      >
        {spinning ? "🎰 Spinning…" : "🎰 SPIN"}
      </button>

      {/* Provably fair link */}
      {lastResult && (
        <details className="glass p-3 text-xs text-gray-400 w-full max-w-md">
          <summary className="cursor-pointer font-semibold text-purple-400">
            🔐 Provably Fair Verification
          </summary>
          <div className="mt-2 space-y-1 break-all">
            <p><strong>Spin ID:</strong> {lastResult.spinId}</p>
            <p><strong>Server Seed Hash:</strong> {lastResult.serverSeedHash}</p>
            <p><strong>Server Seed:</strong> {lastResult.serverSeed}</p>
            <p><strong>Client Seed:</strong> {lastResult.clientSeed}</p>
            <p><strong>Nonce:</strong> {lastResult.nonce}</p>
          </div>
        </details>
      )}
    </div>
  );
}
