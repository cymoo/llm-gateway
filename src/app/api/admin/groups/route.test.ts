import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAdminUser,
  mockSelect,
  mockInsert,
  mockDelete,
} = vi.hoisted(() => {
  const select = vi.fn();
  const insertReturning = vi.fn();
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));
  const deleteWhere = vi.fn();
  const del = vi.fn(() => ({ where: deleteWhere }));

  return {
    mockGetAdminUser: vi.fn(),
    mockSelect: select,
    mockInsert: insert,
    mockInsertReturning: insertReturning,
    mockDelete: del,
    mockDeleteWhere: deleteWhere,
  };
});

vi.mock("@/app/api/admin/middleware", () => ({
  getAdminUser: mockGetAdminUser,
  unauthorizedResponse: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
  badRequestResponse: (msg: string) => Response.json({ error: msg }, { status: 400 }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
  },
}));

import { GET, POST } from "./route";

const GROUPS = [
  { id: "group-default", name: "Default", isDefault: true, remark: null, createdAt: new Date(), updatedAt: new Date(), memberCount: 2 },
  { id: "group-1", name: "Engineering", isDefault: false, remark: "Dev team", createdAt: new Date(), updatedAt: new Date(), memberCount: 5 },
];

describe("GET /api/admin/groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
    // Chain: select().from().leftJoin().groupBy().orderBy()
    mockSelect.mockReturnValue({
      from: () => ({
        leftJoin: () => ({
          groupBy: () => ({
            orderBy: () => Promise.resolve(GROUPS),
          }),
        }),
      }),
    });
  });

  it("returns groups list", async () => {
    const req = {} as never;
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe("Default");
    expect(body[1].name).toBe("Engineering");
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAdminUser.mockResolvedValue(null);
    const req = {} as never;
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/admin/groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
    mockInsert.mockReturnValue({
      values: () => ({
        returning: () =>
          Promise.resolve([{ id: "group-new", name: "Marketing", isDefault: false, remark: null, createdAt: new Date(), updatedAt: new Date() }]),
      }),
    });
  });

  it("creates a new group and returns 201", async () => {
    const req = { json: async () => ({ name: "Marketing", remark: "Marketing team" }) };
    const res = await POST(req as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Marketing");
    expect(body.isDefault).toBe(false);
  });

  it("returns 400 for empty name", async () => {
    const req = { json: async () => ({ name: "   " }) };
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing name", async () => {
    const req = { json: async () => ({ remark: "no name" }) };
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 409 on duplicate name", async () => {
    mockInsert.mockReturnValue({
      values: () => ({
        returning: () => Promise.reject(new Error("duplicate key unique constraint")),
      }),
    });
    const req = { json: async () => ({ name: "Engineering" }) };
    const res = await POST(req as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already exists");
  });

  it("returns 401 when not authenticated", async () => {
    mockGetAdminUser.mockResolvedValue(null);
    const req = { json: async () => ({ name: "X" }) };
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });
});
