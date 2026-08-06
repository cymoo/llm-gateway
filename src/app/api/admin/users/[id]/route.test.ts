import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAdminUser,
  mockSelectLimit,
  mockSelect,
  mockUpdateReturning,
  mockUpdateSet,
  mockUpdate,
  mockDeleteReturning,
  mockDelete,
} = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  const deleteReturning = vi.fn();
  const deleteWhere = vi.fn(() => ({ returning: deleteReturning }));
  const del = vi.fn(() => ({ where: deleteWhere }));

  return {
    mockGetAdminUser: vi.fn(),
    mockSelectLimit: selectLimit,
    mockSelect: select,
    mockUpdateReturning: updateReturning,
    mockUpdateSet: updateSet,
    mockUpdate: update,
    mockDeleteReturning: deleteReturning,
    mockDelete: del,
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
    delete: mockDelete,
  },
}));

import { PUT, DELETE } from "./route";

describe("PUT /api/admin/users/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
    mockSelectLimit.mockResolvedValue([
      { id: "user-1", isAdmin: false, passwordHash: null, remark: null },
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

  it("updates remark when provided", async () => {
    const req = { json: async () => ({ remark: "vip user" }) };
    const res = await PUT(req as never, { params: Promise.resolve({ id: "user-1" }) });

    expect(res.status).toBe(200);
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    const updates = mockUpdateSet.mock.calls[0][0];
    expect(updates.remark).toBe("vip user");
  });

  it("hashes password for non-admin users when provided", async () => {
    const req = { json: async () => ({ password: "Valid#Pass123" }) };
    const res = await PUT(req as never, { params: Promise.resolve({ id: "user-1" }) });

    expect(res.status).toBe(200);
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    const updates = mockUpdateSet.mock.calls[0][0];
    expect(updates.isAdmin).toBeUndefined();
    expect(updates.passwordHash).toBeTypeOf("string");
    expect(updates.passwordHash).not.toBe("Valid#Pass123");
  });
});

describe("DELETE /api/admin/users/[id]", () => {
  const call = (id: string) =>
    DELETE({} as never, { params: Promise.resolve({ id }) });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1", email: "a@b.c" });
    mockDeleteReturning.mockResolvedValue([{ id: "user-1", email: "u@b.c" }]);
  });

  it("deletes a user who has usage history", async () => {
    const res = await call("user-1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("refuses to delete the acting admin", async () => {
    const res = await call("admin-1");

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("your own account");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 404 when the user does not exist", async () => {
    mockDeleteReturning.mockResolvedValue([]);
    const res = await call("ghost");

    expect(res.status).toBe(404);
  });

  it("reports a readable error when a foreign key still references the user", async () => {
    mockDeleteReturning.mockRejectedValue(
      Object.assign(new Error("update or delete on table \"users\" violates foreign key constraint"), {
        code: "23503",
      })
    );
    const res = await call("user-1");
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/cannot be deleted/i);
  });

  it("rethrows unrelated database errors", async () => {
    mockDeleteReturning.mockRejectedValue(
      Object.assign(new Error("connection terminated"), { code: "08006" })
    );

    await expect(call("user-1")).rejects.toThrow("connection terminated");
  });
});
