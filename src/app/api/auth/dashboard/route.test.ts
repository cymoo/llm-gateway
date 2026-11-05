import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockGetAuthUser } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockGetAuthUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { select: mockSelect } }));

vi.mock("@/app/api/auth/middleware", () => ({
  getAuthUser: mockGetAuthUser,
  unauthorizedResponse: () =>
    new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
}));

import { GET } from "./route";
import {
  users,
  groups,
  userModels,
  groupModels,
  userModelQuotas,
  groupModelQuotas,
  dailyUsage,
} from "@/lib/db/schema";

// Chainable drizzle mock that routes results by the table passed to `.from()`,
// so the test is independent of query order. Every dailyUsage query resolves to
// a single zero row (valid for both the `[0]` aggregate reads and the maps).
function setupDb(resolver: (table: unknown, joined: boolean) => unknown[]) {
  mockSelect.mockImplementation(() => {
    let table: unknown;
    let joined = false;
    const c: Record<string, unknown> = {
      from: (t: unknown) => ((table = t), c),
      innerJoin: () => ((joined = true), c),
      where: () => c,
      groupBy: () => c,
      orderBy: () => c,
      limit: () => Promise.resolve(resolver(table, joined)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolver(table, joined)).then(onF, onR),
    };
    return c;
  });
}

const modelColumns = (alias: string) => ({
  modelId: alias,
  alias,
  isActive: true,
  defaultMaxTokensPerDay: null,
  defaultMaxRequestsPerDay: null,
  defaultMaxRequestsPerMin: null,
  defaultAllowedTimeStart: null,
  defaultAllowedTimeEnd: null,
});

const req = { headers: new Headers() } as never;

describe("GET /api/auth/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue({ userId: "user-1" });
  });

  it("shows the union of group models and personal models for a non-default group user", async () => {
    setupDb((table) => {
      if (table === users)
        return [{ id: "user-1", name: "U", email: "u@e", apiKey: "k", isAdmin: false, groupId: "group-1" }];
      if (table === groups)
        return [{ id: "group-1", name: "G", isDefault: false }];
      if (table === groupModels) return [modelColumns("model-a")];
      if (table === userModels) return [modelColumns("model-b")];
      if (table === groupModelQuotas) return [];
      if (table === userModelQuotas) return [];
      if (table === dailyUsage)
        return [{ totalTokens: 0, requestCount: 0, date: "2026-06-30", modelId: null }];
      return [];
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const aliases = body.models.map((m: { alias: string }) => m.alias);

    expect(aliases).toContain("model-a");
    expect(aliases).toContain("model-b");
    expect(body.models).toHaveLength(2);
  });

  it("returns model status and personal usage without exposing quotas or shared usage", async () => {
    setupDb((table, joined) => {
      if (table === users)
        return [{ id: "user-1", name: "U", email: "u@e", apiKey: "k", isAdmin: false, groupId: "group-1" }];
      if (table === groups)
        return [{ id: "group-1", name: "G", isDefault: false }];
      if (table === groupModels || table === userModels)
        return [modelColumns("model-a")];
      if (table === groupModelQuotas || table === userModelQuotas)
        throw new Error("The user dashboard must not query quotas");
      if (table === dailyUsage) {
        if (joined) throw new Error("The user dashboard must not query group usage");
        return [{ totalTokens: 100, requestCount: 1, modelId: "model-a" }];
      }
      return [];
    });

    const res = await GET(req);
    const body = await res.json();

    expect(body.models).toEqual([{
      alias: "model-a",
      isActive: true,
      todayUsage: { totalTokens: 100, requestCount: 1 },
    }]);
  });
});
