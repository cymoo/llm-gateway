import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { db: drizzle({ query } as never) };
});

import { getGroupDailyUsage } from "./group-usage";

describe("getGroupDailyUsage", () => {
  beforeEach(() => vi.resetAllMocks());

  it("sums all current members for the requested group, date and models", async () => {
    query.mockResolvedValue({ rows: [["m1", "1200", "5"]] });
    const rows = await getGroupDailyUsage("g1", "2026-11-05", ["m1", "m2"]);
    expect(rows).toEqual([{ modelId: "m1", totalTokens: 1200, requestCount: 5 }]);
    const [config, params] = query.mock.calls[0];
    expect(config.text).toContain('sum("daily_usage"."total_tokens")');
    expect(config.text).toContain('sum("daily_usage"."request_count")');
    expect(config.text).toContain('inner join "users" on "daily_usage"."user_id" = "users"."id"');
    expect(config.text).toContain('"users"."group_id" = $1');
    expect(config.text).toContain('"daily_usage"."date" = $2');
    expect(config.text).toContain('"daily_usage"."model_id" in ($3, $4)');
    expect(config.text).toContain('group by "daily_usage"."model_id"');
    expect(params).toEqual(["g1", "2026-11-05", "m1", "m2"]);
  });

  it("does not query when there are no group models", async () => {
    expect(await getGroupDailyUsage("g1", "2026-11-05", [])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
