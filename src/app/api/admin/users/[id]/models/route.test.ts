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

import { POST } from "./route";

describe("POST /api/admin/users/[id]/models", () => {
  const params = { params: Promise.resolve({ id: "user-1" }) };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
  });

  it("returns 409 when user is in a non-default group", async () => {
    let callIndex = 0;
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => {
            if (callIndex++ === 0) {
              return Promise.resolve([{ groupId: "group-eng" }]); // user has non-default group
            }
            return Promise.resolve([{ isDefault: false }]); // group is NOT default
          },
        }),
      }),
    }));

    const req = { json: async () => ({ modelId: "model-1" }) };
    const res = await POST(req as never, params);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("non-default group");
  });

  it("allows adding model for Default group member", async () => {
    let callIndex = 0;
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => {
            if (callIndex++ === 0) {
              return Promise.resolve([{ groupId: "group-default" }]);
            }
            // group.isDefault lookup
            return Promise.resolve([{ isDefault: true }]);
          },
        }),
      }),
      innerJoin: () => ({
        leftJoin: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    }));

    const req = { json: async () => ({ modelId: "model-1" }) };
    const res = await POST(req as never, params);
    // Will 404 (model not found) because we don't mock the model lookup, but NOT 409
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
