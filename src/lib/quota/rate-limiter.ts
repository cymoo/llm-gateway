/**
 * In-memory sliding window rate limiter for per-user per-model per-minute limits.
 * Suitable for single-process deployments with <100 concurrency.
 */
class RateLimiter {
  private windows: Map<string, number[]> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Cleanup every 5 minutes
    if (typeof setInterval !== "undefined") {
      this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    }
  }

  check(userId: string, modelId: string, maxPerMin: number): boolean {
    const key = `${userId}:${modelId}`;
    const now = Date.now();
    const windowStart = now - 60_000;
    let timestamps = this.windows.get(key) || [];
    timestamps = timestamps.filter((t) => t > windowStart);
    if (timestamps.length >= maxPerMin) return false;
    timestamps.push(now);
    this.windows.set(key, timestamps);
    return true;
  }

  cleanup() {
    const now = Date.now();
    const windowStart = now - 60_000;
    for (const [key, timestamps] of this.windows.entries()) {
      const fresh = timestamps.filter((t) => t > windowStart);
      if (fresh.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, fresh);
      }
    }
  }

  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var _rateLimiter: RateLimiter | undefined;
}

export function getRateLimiter(): RateLimiter {
  if (!global._rateLimiter) {
    global._rateLimiter = new RateLimiter();
  }
  return global._rateLimiter;
}
