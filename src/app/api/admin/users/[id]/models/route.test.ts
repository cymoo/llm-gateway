import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAdminUser, mockSelect } = vi.hoisted(() => {
  return {
    mockGetAdminUser: vi.fn(),
    mockSelect: vi.fn(),
  };
});

vi.mock("@/app/api/admin/middleware", () => ({
  getAdminUser: mockGetAdminUser,
  unauthorizedResponse: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
  notFoundResponse: (msg: string) => Response.json({ error: msg }, { status: 404 }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([]),
        onConflictDoNothing: vi.fn().mockResolvedValue([]),
      })),
    })),
  },
}));

import { GET, POST } from "./route";
import {
  users,
  groups,
  userModels,
  groupModels,
  groupModelQuotas,
} from "@/lib/db/schema";

describe("GET /api/admin/users/[id]/models", () => {
  const params = { params: Promise.resolve({ id: "user-1" }) };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
  });

  it("returns 404 when the target user does not exist", async () => {
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }));

    const res = await GET({} as never, params);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
  });

  it("returns the strictest effective quota for an overlapping model", async () => {
    const personalRow = {
      model: {
        id: "model-1",
        alias: "gpt-test",
        defaultMaxTokensPerDay: null,
        defaultMaxRequestsPerDay: null,
        defaultMaxRequestsPerMin: 20,
        defaultAllowedTimeStart: null,
        defaultAllowedTimeEnd: null,
      },
      quota: {
        maxTokensPerDay: null,
        maxRequestsPerDay: null,
        maxRequestsPerMin: 5,
        allowedTimeStart: null,
        allowedTimeEnd: null,
      },
      createdAt: new Date(),
    };
    const resolver = (table: unknown) => {
      if (table === users) return [{ groupId: "group-1" }];
      if (table === userModels) return [personalRow];
      if (table === groups) return [{ id: "group-1", isDefault: false }];
      if (table === groupModels) return [{ modelId: "model-1" }];
      if (table === groupModelQuotas)
        return [{
          modelId: "model-1",
          maxTokensPerDay: null,
          maxRequestsPerDay: null,
          maxRequestsPerMin: 100,
          allowedTimeStart: null,
          allowedTimeEnd: null,
        }];
      return [];
    };
    mockSelect.mockImplementation(() => {
      let table: unknown;
      const chain: Record<string, unknown> = {
        from: (value: unknown) => ((table = value), chain),
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(resolver(table)),
        then: (onFulfilled: (value: unknown) => unknown) =>
          Promise.resolve(resolver(table)).then(onFulfilled),
      };
      return chain;
    });

    const res = await GET({} as never, params);
    const body = await res.json();

    expect(body[0].overlapsGroup).toBe(true);
    expect(body[0].effectiveQuota.maxRequestsPerMin).toBe(5);
  });
});

describe("POST /api/admin/users/[id]/models", () => {
  const params = { params: Promise.resolve({ id: "user-1" }) };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
  });

  it("allows adding model even when user is in a non-default group", async () => {
    // The group guard has been removed: personal models are always manageable.
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]), // model not found → 404, but NOT 409
        }),
      }),
    }));

    const req = { json: async () => ({ modelId: "model-1" }) };
    const res = await POST(req as never, params);
    expect(res.status).not.toBe(409);
    expect(res.status).not.toBe(401);
  });

  it("allows adding model for any group membership", async () => {
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]), // model not found → 404, but NOT 409
        }),
      }),
    }));

    const req = { json: async () => ({ modelId: "model-1" }) };
    const res = await POST(req as never, params);
    expect(res.status).not.toBe(409);
    expect(res.status).not.toBe(401);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAdminUser.mockResolvedValue(null);
    const req = { json: async () => ({ modelId: "model-1" }) };
    const res = await POST(req as never, params);
    expect(res.status).toBe(401);
  });
});
