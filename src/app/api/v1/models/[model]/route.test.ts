import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { select: mockSelect } }));

import { GET } from "./route";
import {
  users,
  groups,
  models,
  modelBackends,
  userModels,
  groupModels,
} from "@/lib/db/schema";
import { _resetContextWindowCache } from "@/lib/proxy/context-window";

// Chainable drizzle mock that routes results by the table passed to `.from()`.
function setupDb(resolver: (table: unknown) => unknown[]) {
  mockSelect.mockImplementation(() => {
    let table: unknown;
    const c: Record<string, unknown> = {
      from: (t: unknown) => ((table = t), c),
      where: () => c,
      limit: () => Promise.resolve(resolver(table)),
      orderBy: () => Promise.resolve(resolver(table)),
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

const backendRow = {
  id: "backend-1",
  modelId: "id-a",
  backendUrl: "http://backend/v1",
  backendModel: "backend-a",
  backendApiKey: null,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const req = {
  headers: new Headers({ authorization: "Bearer test-key" }),
} as never;
const params = { params: Promise.resolve({ model: "model-a" }) };

describe("GET /api/v1/models/[model]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetContextWindowCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("authorizes a non-default group user via their personal model list and attaches the window", async () => {
    setupDb((table) => {
      if (table === models) return [model];
      if (table === users)
        return [{ id: "user-1", apiKey: "test-key", isActive: true, groupId: "group-1" }];
      if (table === groups) return [{ id: "group-1", isDefault: false }];
      // Not in the group, but present in the user's personal list.
      if (table === groupModels) return [];
      if (table === userModels) return [{ userId: "user-1", modelId: "id-a" }];
      if (table === modelBackends) return [backendRow];
      return [];
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ id: "backend-a", max_model_len: 32768 }] }),
          { status: 200 }
        )
      )
    );

    const res = await GET(req, params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("model-a");
    expect(body.max_model_len).toBe(32768);
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
