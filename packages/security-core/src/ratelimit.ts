/**
 * Simple in-memory sliding window rate limiter.
 * In production, use Redis-backed rate limiting.
 */
export class RateLimiter {
  private windows = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  isAllowed(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    const timestamps = (this.windows.get(key) ?? []).filter(
      (t) => t > cutoff
    );
    timestamps.push(now);
    this.windows.set(key, timestamps);

    return timestamps.length <= this.maxRequests;
  }

  reset(key: string): void {
    this.windows.delete(key);
  }
}
