import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { select: mockSelect } }));

import { GET } from "./route";
import { users, groups, userModels, groupModels } from "@/lib/db/schema";
import { _resetContextWindowCache } from "@/lib/proxy/context-window";

// Chainable drizzle mock that routes results by the table passed to `.from()`,
// so the test is independent of query order.
function setupDb(resolver: (table: unknown) => unknown[]) {
  mockSelect.mockImplementation(() => {
    let table: unknown;
    const c: Record<string, unknown> = {
      from: (t: unknown) => ((table = t), c),
      innerJoin: () => c,
      where: () => c,
      limit: () => Promise.resolve(resolver(table)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolver(table)).then(onF, onR),
    };
    return c;
  });
}

const modelA = {
  id: "id-a",
  alias: "model-a",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  isActive: true,
};
const modelB = {
  id: "id-b",
  alias: "model-b",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  isActive: true,
};

const req = {
  headers: new Headers({ authorization: "Bearer test-key" }),
} as never;

describe("GET /api/v1/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetContextWindowCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the union of group models and personal models for a non-default group user", async () => {
    setupDb((table) => {
      if (table === users)
        return [{ id: "user-1", apiKey: "test-key", isActive: true, groupId: "group-1" }];
      if (table === groups) return [{ id: "group-1", isDefault: false }];
      if (table === groupModels) return [{ model: modelA }];
      // Personal list overlaps group on modelA and adds modelB.
      if (table === userModels) return [{ model: modelB }, { model: modelA }];
      return [];
    });

    const res = await GET(req);
    const body = await res.json();
    const ids = body.data.map((m: { id: string }) => m.id);

    expect(ids).toContain("model-a");
    expect(ids).toContain("model-b");
    // Overlapping model appears only once.
    expect(ids.filter((id: string) => id === "model-a")).toHaveLength(1);
    expect(body.data).toHaveLength(2);
  });

  it("returns only personal models for a default group user", async () => {
    setupDb((table) => {
      if (table === users)
        return [{ id: "user-1", apiKey: "test-key", isActive: true, groupId: "group-1" }];
      if (table === groups) return [{ id: "group-1", isDefault: true }];
      if (table === userModels) return [{ model: modelB }];
      return [];
    });

    const res = await GET(req);
    const body = await res.json();
    const ids = body.data.map((m: { id: string }) => m.id);

    expect(ids).toEqual(["model-b"]);
  });

  it("enriches entries with max_model_len probed from the backend, omitting it when absent", async () => {
    setupDb((table) => {
      if (table === users)
        return [{ id: "user-1", apiKey: "test-key", isActive: true, groupId: "group-1" }];
      if (table === groups) return [{ id: "group-1", isDefault: true }];
      if (table === userModels)
        return [
          {
            model: {
              id: "id-a",
              alias: "model-a",
              backendUrl: "http://backend/v1",
              backendModel: "backend-a",
              createdAt: new Date("2026-01-01T00:00:00Z"),
              isActive: true,
            },
          },
          {
            model: {
              id: "id-b",
              alias: "model-b",
              backendUrl: "http://backend/v1",
              backendModel: "backend-b",
              createdAt: new Date("2026-01-01T00:00:00Z"),
              isActive: true,
            },
          },
        ];
      return [];
    });

    // Single backend probe covers both models; only backend-a advertises a window.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "backend-a", max_model_len: 65536 }] }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(req);
    const body = await res.json();
    const byId = Object.fromEntries(
      body.data.map((m: { id: string }) => [m.id, m])
    );

    expect(byId["model-a"].max_model_len).toBe(65536);
    expect(byId["model-b"]).not.toHaveProperty("max_model_len");
    // Shared backend probed once, not once per model.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
