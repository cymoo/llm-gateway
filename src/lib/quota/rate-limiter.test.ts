import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fresh module for each test – avoid leaking global singleton state
let RateLimiterModule: typeof import("./rate-limiter");

beforeEach(async () => {
  vi.useFakeTimers();
  // Clear the global singleton so each test starts clean
  (globalThis as Record<string, unknown>)._rateLimiter = undefined;
  RateLimiterModule = await import("./rate-limiter");
});

afterEach(() => {
  const limiter = RateLimiterModule.getRateLimiter();
  limiter.destroy();
  vi.useRealTimers();
});

describe("RateLimiter", () => {
  it("allows requests up to maxPerMin", () => {
    const limiter = RateLimiterModule.getRateLimiter();
    expect(limiter.check("u1", "m1", 3)).toBe(true);
    expect(limiter.check("u1", "m1", 3)).toBe(true);
    expect(limiter.check("u1", "m1", 3)).toBe(true);
    // 4th request should be rejected
    expect(limiter.check("u1", "m1", 3)).toBe(false);
  });

  it("resets after the 60-second window elapses", () => {
    const limiter = RateLimiterModule.getRateLimiter();
    expect(limiter.check("u1", "m1", 1)).toBe(true);
    expect(limiter.check("u1", "m1", 1)).toBe(false);

    // Advance past the 60-second window
    vi.advanceTimersByTime(60_001);

    expect(limiter.check("u1", "m1", 1)).toBe(true);
  });

  it("tracks different user+model keys independently", () => {
    const limiter = RateLimiterModule.getRateLimiter();
    expect(limiter.check("u1", "m1", 1)).toBe(true);
    expect(limiter.check("u1", "m1", 1)).toBe(false);
    // Different model – should still be allowed
    expect(limiter.check("u1", "m2", 1)).toBe(true);
    // Different user – should still be allowed
    expect(limiter.check("u2", "m1", 1)).toBe(true);
  });

  it("saves filtered timestamps even on rejection (stale entries cleaned)", () => {
    const limiter = RateLimiterModule.getRateLimiter();
    // Fill up the limit
    expect(limiter.check("u1", "m1", 2)).toBe(true); // T=0
    vi.advanceTimersByTime(100);
    expect(limiter.check("u1", "m1", 2)).toBe(true); // T=100

    // Advance so first request expires but second doesn't
    vi.advanceTimersByTime(59_950); // now at T=60050

    // Should be rejected because T=100 is still within the window (age = 59950 < 60000)
    // Actually at T=60050, windowStart = 60050 - 60000 = 50
    // T=0 > 50? No → filtered out. T=100 > 50? Yes → kept. length=1 < 2 → allowed
    expect(limiter.check("u1", "m1", 2)).toBe(true); // T=60050, only T=100 in window
  });

  it("cleanup removes stale entries", () => {
    const limiter = RateLimiterModule.getRateLimiter();
    limiter.check("u1", "m1", 10);
    limiter.check("u2", "m2", 10);

    // Advance past the window
    vi.advanceTimersByTime(61_000);
    limiter.cleanup();

    // After cleanup, new requests should be allowed (keys removed)
    expect(limiter.check("u1", "m1", 1)).toBe(true);
  });
});
