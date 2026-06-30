import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { select: mockSelect } }));

import { GET } from "./route";
import { users, groups, models, userModels, groupModels } from "@/lib/db/schema";

// Chainable drizzle mock that routes results by the table passed to `.from()`.
function setupDb(resolver: (table: unknown) => unknown[]) {
  mockSelect.mockImplementation(() => {
    let table: unknown;
    const c: Record<string, unknown> = {
      from: (t: unknown) => ((table = t), c),
      where: () => c,
      limit: () => Promise.resolve(resolver(table)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolver(table)).then(onF, onR),
    };
    return c;
  });
}

const model = {
  id: "id-a",
  alias: "model-a",
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const req = {
  headers: new Headers({ authorization: "Bearer test-key" }),
} as never;
const params = { params: Promise.resolve({ model: "model-a" }) };

describe("GET /api/v1/models/[model]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("authorizes a non-default group user via their personal model list", async () => {
    setupDb((table) => {
      if (table === models) return [model];
      if (table === users)
        return [{ id: "user-1", apiKey: "test-key", isActive: true, groupId: "group-1" }];
      if (table === groups) return [{ id: "group-1", isDefault: false }];
      // Not in the group, but present in the user's personal list.
      if (table === groupModels) return [];
      if (table === userModels) return [{ userId: "user-1", modelId: "id-a" }];
      return [];
    });

    const res = await GET(req, params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("model-a");
  });

  it("rejects when the model is in neither the group nor the personal list", async () => {
    setupDb((table) => {
      if (table === models) return [model];
      if (table === users)
        return [{ id: "user-1", apiKey: "test-key", isActive: true, groupId: "group-1" }];
      if (table === groups) return [{ id: "group-1", isDefault: false }];
      return [];
    });

    const res = await GET(req, params);
    expect(res.status).toBe(403);
  });
});
