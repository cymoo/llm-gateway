import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAdminUser,
  mockSelect,
  mockFrom,
  mockInnerJoin,
  mockWhere,
  mockOrderBy,
} = vi.hoisted(() => {
  const orderBy = vi.fn();
  const where = vi.fn(() => ({ orderBy }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));

  return {
    mockGetAdminUser: vi.fn(),
    mockSelect: select,
    mockFrom: from,
    mockInnerJoin: innerJoin,
    mockWhere: where,
    mockOrderBy: orderBy,
  };
});

vi.mock("@/app/api/admin/middleware", () => ({
  getAdminUser: mockGetAdminUser,
  unauthorizedResponse: () =>
    Response.json({ error: "Unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
  },
}));

import { GET } from "./route";

describe("GET /api/admin/models/[id]/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
    mockOrderBy.mockResolvedValue([
      {
        id: "user-1",
        name: "Alice",
        email: "alice@example.com",
      },
    ]);
  });

  it("returns authorized users for a model", async () => {
    const req = {} as never;
    const res = await GET(req, { params: Promise.resolve({ id: "model-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([
      { id: "user-1", name: "Alice", email: "alice@example.com" },
    ]);
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockInnerJoin).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockOrderBy).toHaveBeenCalledTimes(1);
  });
});
