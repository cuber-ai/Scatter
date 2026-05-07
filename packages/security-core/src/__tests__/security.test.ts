import { describe, it, expect } from "vitest";
import { validatePassword } from "../password.js";
import { generateCsrfToken, validateCsrfToken } from "../csrf.js";
import { RateLimiter } from "../ratelimit.js";
import { FraudScorer } from "../fraud.js";

describe("validatePassword", () => {
  it("rejects short passwords", () => {
    const result = validatePassword("short");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects passwords without special chars", () => {
    const result = validatePassword("NoSpecialChar123");
    expect(result.valid).toBe(false);
  });

  it("accepts strong passwords", () => {
    const result = validatePassword("Str0ng!P@ssw0rd#");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("CSRF tokens", () => {
  it("generates a 64-char hex token", () => {
    const token = generateCsrfToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("validates matching tokens", () => {
    const token = generateCsrfToken();
    expect(validateCsrfToken(token, token)).toBe(true);
  });

  it("rejects mismatched tokens", () => {
    const t1 = generateCsrfToken();
    const t2 = generateCsrfToken();
    expect(validateCsrfToken(t1, t2)).toBe(false);
  });

  it("rejects empty tokens", () => {
    expect(validateCsrfToken("", "")).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows requests within limit", () => {
    const limiter = new RateLimiter(3, 1000);
    expect(limiter.isAllowed("user1")).toBe(true);
    expect(limiter.isAllowed("user1")).toBe(true);
    expect(limiter.isAllowed("user1")).toBe(true);
  });

  it("blocks requests over limit", () => {
    const limiter = new RateLimiter(2, 1000);
    limiter.isAllowed("user2");
    limiter.isAllowed("user2");
    expect(limiter.isAllowed("user2")).toBe(false);
  });

  it("resets state", () => {
    const limiter = new RateLimiter(1, 1000);
    limiter.isAllowed("user3");
    expect(limiter.isAllowed("user3")).toBe(false);
    limiter.reset("user3");
    expect(limiter.isAllowed("user3")).toBe(true);
  });
});

describe("FraudScorer", () => {
  const scorer = new FraudScorer();

  it("gives LOW risk for clean signals", () => {
    const result = scorer.score({
      userId: "user1",
      ipAddress: "1.2.3.4",
      userAgent: "Chrome",
    });
    expect(result.risk).toBe("LOW");
    expect(result.action).toBe("ALLOW");
    expect(result.flags).toHaveLength(0);
  });

  it("flags VPN usage", () => {
    const result = scorer.score({
      userId: "user2",
      ipAddress: "1.2.3.4",
      userAgent: "Chrome",
      isVpn: true,
    });
    expect(result.flags).toContain("VPN_DETECTED");
    expect(result.score).toBeGreaterThan(0);
  });

  it("flags abnormal win rate", () => {
    const result = scorer.score({
      userId: "user3",
      ipAddress: "1.2.3.4",
      userAgent: "Chrome",
      winRate: 0.95,
    });
    expect(result.flags).toContain("ABNORMAL_WIN_RATE");
  });

  it("recommends BAN for maximum risk", () => {
    const result = scorer.score({
      userId: "user4",
      ipAddress: "1.2.3.4",
      userAgent: "bot",
      isVpn: true,
      isProxy: true,
      winRate: 0.99,
      rapidSpinCount: 200,
      multipleAccountSameIp: true,
    });
    expect(result.action).toBe("BAN");
    expect(result.risk).toBe("CRITICAL");
  });
});
