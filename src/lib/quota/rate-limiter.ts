export interface RateLimit {
  subjectId: string;
  modelId: string;
  maxPerMin: number;
}

/**
 * In-memory sliding window rate limiter for personal and shared group per-model per-minute limits.
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
    return this.checkAll([{ subjectId: userId, modelId, maxPerMin }]) === null;
  }

  /** Returns the rejected limit, or consumes one request in every scope. */
  checkAll(limits: RateLimit[]): RateLimit | null {
    const now = Date.now();
    const windowStart = now - 60_000;
    const windows = limits.map((limit) => {
      const key = `${limit.subjectId}:${limit.modelId}`;
      const timestamps = (this.windows.get(key) ?? []).filter((t) => t > windowStart);
      this.windows.set(key, timestamps);
      return { limit, timestamps };
    });
    const rejected = windows.find(({ limit, timestamps }) => timestamps.length >= limit.maxPerMin);
    if (rejected) return rejected.limit;
    // This method is synchronous, so the multi-scope check and update are atomic
    // within the process just like a single-scope check.
    for (const { timestamps } of windows) timestamps.push(now);
    return null;
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
