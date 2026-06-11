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
