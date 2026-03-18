import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAdminUser,
  mockSelectLimit,
  mockSelect,
  mockUpdateReturning,
  mockUpdateSet,
  mockUpdate,
} = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    mockGetAdminUser: vi.fn(),
    mockSelectLimit: selectLimit,
    mockSelect: select,
    mockUpdateReturning: updateReturning,
    mockUpdateSet: updateSet,
    mockUpdate: update,
  };
});

vi.mock("@/app/api/admin/middleware", () => ({
  getAdminUser: mockGetAdminUser,
  unauthorizedResponse: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
  notFoundResponse: (message: string) => Response.json({ error: message }, { status: 404 }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
}));

import { PUT } from "./route";

describe("PUT /api/admin/users/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
    mockSelectLimit.mockResolvedValue([
      { id: "user-1", isAdmin: false, passwordHash: null },
    ]);
    mockUpdateReturning.mockResolvedValue([{ id: "user-1" }]);
  });

  it("requires password when enabling admin access", async () => {
    const req = { json: async () => ({ isAdmin: true }) };
    const res = await PUT(req as never, { params: Promise.resolve({ id: "user-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Password is required");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects admin passwords with illegal characters", async () => {
    const req = { json: async () => ({ isAdmin: true, password: "Bad\nPass123" }) };
    const res = await PUT(req as never, { params: Promise.resolve({ id: "user-1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid password");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("hashes password when enabling admin access with valid password", async () => {
    mockUpdateReturning.mockResolvedValue([
      {
        id: "user-1",
        isAdmin: true,
      },
    ]);
    const req = { json: async () => ({ isAdmin: true, password: "Valid#Pass123" }) };
    const res = await PUT(req as never, { params: Promise.resolve({ id: "user-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isAdmin).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    const updates = mockUpdateSet.mock.calls[0][0];
    expect(updates.isAdmin).toBe(true);
    expect(updates.passwordHash).toBeTypeOf("string");
    expect(updates.passwordHash).not.toBe("Valid#Pass123");
  });
});
