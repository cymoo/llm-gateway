import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAdminUser,
  mockInsertReturning,
  mockInsert,
} = vi.hoisted(() => {
  const insertReturning = vi.fn();
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));
  return {
    mockGetAdminUser: vi.fn(),
    mockInsertReturning: insertReturning,
    mockInsert: insert,
  };
});

vi.mock("@/app/api/admin/middleware", () => ({
  getAdminUser: mockGetAdminUser,
  unauthorizedResponse: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: mockInsert,
  },
}));

import { POST } from "./route";

describe("POST /api/admin/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
    mockInsertReturning.mockResolvedValue([
      {
        id: "model-1",
        alias: "gpt_4.1-mini",
      },
    ]);
  });

  it("accepts model alias containing underscore and dot", async () => {
    const req = {
      json: async () => ({
        alias: "gpt_4.1-mini",
        backendUrl: "https://api.example.com/v1",
        backendModel: "gpt-4.1-mini",
      }),
    };
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.alias).toBe("gpt_4.1-mini");
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("still rejects alias starting with invalid characters", async () => {
    const req = {
      json: async () => ({
        alias: "-bad.alias",
        backendUrl: "https://api.example.com/v1",
        backendModel: "gpt-4.1-mini",
      }),
    };
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid alias");
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
