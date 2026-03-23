import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAdminUser,
  mockUpdate,
  mockUpdateSet,
  mockUpdateReturning,
} = vi.hoisted(() => {
  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  return {
    mockGetAdminUser: vi.fn(),
    mockUpdate: update,
    mockUpdateSet: updateSet,
    mockUpdateReturning: updateReturning,
  };
});

vi.mock("@/app/api/admin/middleware", () => ({
  getAdminUser: mockGetAdminUser,
  unauthorizedResponse: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
  notFoundResponse: (message: string) => Response.json({ error: message }, { status: 404 }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    update: mockUpdate,
  },
}));

import { POST } from "./route";

describe("POST /api/admin/users/[id]/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
    mockUpdateReturning.mockResolvedValue([{ id: "user-1", isActive: true }]);
  });

  it("approves a pending user", async () => {
    const res = await POST({} as never, { params: Promise.resolve({ id: "user-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet.mock.calls[0][0].isActive).toBe(true);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetAdminUser.mockResolvedValue(null);
    const res = await POST({} as never, { params: Promise.resolve({ id: "user-1" }) });

    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when user is not found", async () => {
    mockUpdateReturning.mockResolvedValue([]);
    const res = await POST({} as never, { params: Promise.resolve({ id: "missing-user" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("User not found");
  });
});
