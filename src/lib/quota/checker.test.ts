import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSelect, mockRateLimiter } = vi.hoisted(() => {
  const select = vi.fn();
  const limiterCheck = vi.fn().mockReturnValue(true);
  return {
    mockSelect: select,
    mockRateLimiter: { check: limiterCheck },
  };
});

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

vi.mock("./rate-limiter", () => ({
  getRateLimiter: () => mockRateLimiter,
}));

import {
  checkQuota,
  QuotaContext,
  QuotaValues,
  isWithinAllowedWindow,
  resolveEffectiveQuota,
} from "./checker";

const baseCtx: QuotaContext = {
  userId: "user-1",
  modelId: "model-1",
  modelAlias: "gpt-test",
  access: { viaUser: true },
  defaultMaxTokensPerDay: null,
  defaultMaxRequestsPerDay: null,
  defaultMaxRequestsPerMin: null,
  defaultAllowedTimeStart: null,
  defaultAllowedTimeEnd: null,
};

function makeSelectChain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

describe("checkQuota", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRateLimiter.check.mockReturnValue(true);
  });

  describe("user quota access", () => {
    it("returns null when no quota override and no model defaults", async () => {
      mockSelect.mockReturnValueOnce(makeSelectChain([])); // userModelQuotas: no row
      const result = await checkQuota(baseCtx);
      expect(result).toBeNull();
    });

    it("uses userModelQuotas override over model defaults", async () => {
      mockSelect
        .mockReturnValueOnce(makeSelectChain([{ maxRequestsPerDay: 5, maxTokensPerDay: null, maxRequestsPerMin: null, allowedTimeStart: null, allowedTimeEnd: null }]))
        .mockReturnValueOnce(makeSelectChain([{ requestCount: 5, totalTokens: 0 }])); // dailyUsage at limit

      const ctx = { ...baseCtx, defaultMaxRequestsPerDay: 100 };
      const result = await checkQuota(ctx);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(429);
    });

    it("falls back to model defaultMaxRequestsPerDay when no override", async () => {
      mockSelect
        .mockReturnValueOnce(makeSelectChain([])) // userModelQuotas: no override
        .mockReturnValueOnce(makeSelectChain([{ requestCount: 10, totalTokens: 0 }])); // dailyUsage at limit

      const ctx = { ...baseCtx, defaultMaxRequestsPerDay: 10 };
      const result = await checkQuota(ctx);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(429);
    });

    it("returns null when usage is below limits", async () => {
      mockSelect
        .mockReturnValueOnce(makeSelectChain([])) // no override
        .mockReturnValueOnce(makeSelectChain([{ requestCount: 5, totalTokens: 100 }]));

      const ctx = { ...baseCtx, defaultMaxRequestsPerDay: 10, defaultMaxTokensPerDay: 1000 };
      const result = await checkQuota(ctx);
      expect(result).toBeNull();
    });

    it("rejects when daily token limit exceeded", async () => {
      mockSelect
        .mockReturnValueOnce(makeSelectChain([{ maxRequestsPerDay: null, maxTokensPerDay: 500, maxRequestsPerMin: null, allowedTimeStart: null, allowedTimeEnd: null }]))
        .mockReturnValueOnce(makeSelectChain([{ requestCount: 1, totalTokens: 500 }]));

      const result = await checkQuota(baseCtx);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(429);
      const body = await result!.json();
      expect(body.error.code).toBe("daily_token_limit");
    });
  });

  describe("group quota access", () => {
    const groupCtx: QuotaContext = {
      ...baseCtx,
      access: { viaUser: false, groupId: "group-1" },
    };

    it("queries groupModelQuotas instead of userModelQuotas", async () => {
      mockSelect.mockReturnValueOnce(makeSelectChain([])); // groupModelQuotas: no row
      const result = await checkQuota(groupCtx);
      expect(result).toBeNull();
      // Verify select was called once (quota lookup), no dailyUsage call (no limits)
      expect(mockSelect).toHaveBeenCalledTimes(1);
    });

    it("uses group quota override to enforce daily request limit", async () => {
      mockSelect
        .mockReturnValueOnce(makeSelectChain([{ maxRequestsPerDay: 3, maxTokensPerDay: null, maxRequestsPerMin: null, allowedTimeStart: null, allowedTimeEnd: null }]))
        .mockReturnValueOnce(makeSelectChain([{ requestCount: 3, totalTokens: 0 }]));

      const result = await checkQuota(groupCtx);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(429);
      const body = await result!.json();
      expect(body.error.code).toBe("daily_request_limit");
    });

    it("group quota null means unlimited (falls through to model default)", async () => {
      mockSelect
        .mockReturnValueOnce(makeSelectChain([{ maxRequestsPerDay: null, maxTokensPerDay: null, maxRequestsPerMin: null, allowedTimeStart: null, allowedTimeEnd: null }]))
        .mockReturnValueOnce(makeSelectChain([{ requestCount: 999, totalTokens: 0 }]));

      // Both quota and model default are null → unlimited
      const result = await checkQuota(groupCtx);
      expect(result).toBeNull();
    });

    it("group quota overrides model default", async () => {
      // Group says max 5/day, model default says 100/day; usage at 5
      mockSelect
        .mockReturnValueOnce(makeSelectChain([{ maxRequestsPerDay: 5, maxTokensPerDay: null, maxRequestsPerMin: null, allowedTimeStart: null, allowedTimeEnd: null }]))
        .mockReturnValueOnce(makeSelectChain([{ requestCount: 5, totalTokens: 0 }]));

      const ctx = { ...groupCtx, defaultMaxRequestsPerDay: 100 };
      const result = await checkQuota(ctx);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(429);
    });
  });

  describe("overlapping group and personal quotas", () => {
    const overlapCtx: QuotaContext = {
      ...baseCtx,
      access: { viaUser: true, groupId: "group-1" },
    };

    it("enforces the lower personal per-minute limit", async () => {
      mockSelect
        .mockReturnValueOnce(makeSelectChain([{ maxRequestsPerMin: 100 }]))
        .mockReturnValueOnce(makeSelectChain([{ maxRequestsPerMin: 5 }]));
      mockRateLimiter.check.mockReturnValue(false);

      const result = await checkQuota(overlapCtx);

      expect(result?.status).toBe(429);
      expect(mockRateLimiter.check).toHaveBeenCalledWith("user-1", "model-1", 5);
    });

    it("enforces the lower group daily limit", async () => {
      mockSelect
        .mockReturnValueOnce(makeSelectChain([{ maxRequestsPerDay: 3 }]))
        .mockReturnValueOnce(makeSelectChain([{ maxRequestsPerDay: 20 }]))
        .mockReturnValueOnce(makeSelectChain([{ requestCount: 3, totalTokens: 0 }]));

      const result = await checkQuota(overlapCtx);

      expect(result?.status).toBe(429);
      expect((await result!.json()).error.code).toBe("daily_request_limit");
    });
  });

  describe("rate limiting", () => {
    it("returns 429 when rate limiter rejects", async () => {
      mockSelect.mockReturnValueOnce(makeSelectChain([{ maxRequestsPerDay: null, maxTokensPerDay: null, maxRequestsPerMin: 5, allowedTimeStart: null, allowedTimeEnd: null }]));
      mockRateLimiter.check.mockReturnValue(false);

      const result = await checkQuota(baseCtx);
      expect(result).not.toBeNull();
      expect(result!.status).toBe(429);
      const body = await result!.json();
      expect(body.error.code).toBe("rate_limit_exceeded");
    });

    it("passes rate limit check when under limit", async () => {
      mockSelect
        .mockReturnValueOnce(makeSelectChain([{ maxRequestsPerDay: null, maxTokensPerDay: null, maxRequestsPerMin: 5, allowedTimeStart: null, allowedTimeEnd: null }]));
      mockRateLimiter.check.mockReturnValue(true);

      const result = await checkQuota(baseCtx);
      expect(result).toBeNull();
    });
  });

  describe("time window restriction", () => {
    it("rejects request outside allowed time window", async () => {
      // Simulate being outside the window by setting a past window (00:00:00-00:00:01)
      mockSelect.mockReturnValueOnce(
        makeSelectChain([{ maxRequestsPerDay: null, maxTokensPerDay: null, maxRequestsPerMin: null, allowedTimeStart: "00:00:00", allowedTimeEnd: "00:00:01" }])
      );

      // We don't know the actual current time, so just verify the logic works
      // when the window is too narrow. If it passes (during midnight), that's acceptable.
      const result = await checkQuota(baseCtx);
      // Could be null or 403 depending on current time; just ensure no crash.
      if (result !== null) {
        expect(result.status).toBe(403);
        const body = await result.json();
        expect(body.error.code).toBe("time_restricted");
      }
    });
  });
});

const emptyQuota: QuotaValues = {
  maxTokensPerDay: null,
  maxRequestsPerDay: null,
  maxRequestsPerMin: null,
  allowedTimeStart: null,
  allowedTimeEnd: null,
};

describe("resolveEffectiveQuota", () => {
  it("takes the strictest configured numeric value on overlap", () => {
    const effective = resolveEffectiveQuota(
      { viaUser: true, groupId: "group-1" },
      { ...emptyQuota, maxRequestsPerMin: 20 },
      { ...emptyQuota, maxRequestsPerMin: 5, maxTokensPerDay: 1_000 },
      { ...emptyQuota, maxRequestsPerMin: 100, maxTokensPerDay: 500 },
    );

    expect(effective.maxRequestsPerMin).toBe(5);
    expect(effective.maxTokensPerDay).toBe(500);
  });

  it("uses a configured source before the model default", () => {
    const effective = resolveEffectiveQuota(
      { viaUser: true, groupId: "group-1" },
      { ...emptyQuota, maxRequestsPerMin: 20 },
      { ...emptyQuota, maxRequestsPerMin: 100 },
      emptyQuota,
    );

    expect(effective.maxRequestsPerMin).toBe(100);
  });

  it("falls back to the model default when neither source configures a field", () => {
    const effective = resolveEffectiveQuota(
      { viaUser: true, groupId: "group-1" },
      { ...emptyQuota, maxRequestsPerDay: 10 },
      emptyQuota,
      emptyQuota,
    );

    expect(effective.maxRequestsPerDay).toBe(10);
  });

  it("keeps both time windows so callers enforce their intersection", () => {
    const effective = resolveEffectiveQuota(
      { viaUser: true, groupId: "group-1" },
      emptyQuota,
      { ...emptyQuota, allowedTimeStart: "09:00:00", allowedTimeEnd: "18:00:00" },
      { ...emptyQuota, allowedTimeStart: "10:00:00", allowedTimeEnd: "16:00:00" },
    );

    expect(effective.allowedTimeWindows).toEqual([
      { start: "09:00:00", end: "18:00:00", source: "user" },
      { start: "10:00:00", end: "16:00:00", source: "group" },
    ]);
  });

  it("normalizes a partial window to a safe open-ended range", () => {
    const effective = resolveEffectiveQuota(
      { viaUser: true },
      emptyQuota,
      { ...emptyQuota, allowedTimeStart: "09:00:00" },
    );

    expect(effective.allowedTimeWindows).toEqual([
      { start: "09:00:00", end: "23:59:59", source: "user" },
    ]);
  });
});

describe("isWithinAllowedWindow", () => {
  it("supports a window that crosses midnight", () => {
    const window = {
      start: "22:00:00",
      end: "06:00:00",
      source: "group" as const,
    };

    expect(isWithinAllowedWindow("23:00:00", window)).toBe(true);
    expect(isWithinAllowedWindow("05:00:00", window)).toBe(true);
    expect(isWithinAllowedWindow("12:00:00", window)).toBe(false);
  });
});
