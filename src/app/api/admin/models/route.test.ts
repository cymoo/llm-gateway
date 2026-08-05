import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAdminUser,
  mockInsertReturning,
  mockInsertValues,
  mockInsert,
  mockTransaction,
} = vi.hoisted(() => {
  const insertReturning = vi.fn();
  const insertValues = vi.fn((..._args: unknown[]) => ({
    returning: insertReturning,
  }));
  const insert = vi.fn(() => ({ values: insertValues }));
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ insert })
  );
  return {
    mockGetAdminUser: vi.fn(),
    mockInsertReturning: insertReturning,
    mockInsertValues: insertValues,
    mockInsert: insert,
    mockTransaction: transaction,
  };
});

vi.mock("@/app/api/admin/middleware", () => ({
  getAdminUser: mockGetAdminUser,
  unauthorizedResponse: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: mockInsert,
    transaction: mockTransaction,
  },
}));

import { POST } from "./route";

describe("POST /api/admin/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
    // First returning() call: the model row; second: the backend rows.
    mockInsertReturning
      .mockResolvedValueOnce([
        {
          id: "model-1",
          alias: "gpt_4.1-mini",
          remark: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "backend-1",
          modelId: "model-1",
          backendUrl: "https://api.example.com/v1",
          backendModel: "gpt-4.1-mini",
        },
      ]);
  });

  it("accepts model alias containing underscore and dot", async () => {
    const req = {
      json: async () => ({
        alias: "gpt_4.1-mini",
        backends: [
          {
            backendUrl: "https://api.example.com/v1",
            backendModel: "gpt-4.1-mini",
          },
        ],
      }),
    };
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.alias).toBe("gpt_4.1-mini");
    expect(body.backends).toHaveLength(1);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it("accepts the legacy flat single-backend shorthand", async () => {
    const req = {
      json: async () => ({
        alias: "gpt_4.1-mini",
        backendUrl: "https://api.example.com/v1",
        backendModel: "gpt-4.1-mini",
        backendApiKey: "sk-be",
      }),
    };
    const res = await POST(req as never);

    expect(res.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledTimes(2);
    const backendValues = mockInsertValues.mock.calls[1][0];
    expect(backendValues).toEqual([
      expect.objectContaining({
        modelId: "model-1",
        backendUrl: "https://api.example.com/v1",
        backendModel: "gpt-4.1-mini",
        backendApiKey: "sk-be",
        isActive: true,
      }),
    ]);
  });

  it("accepts multiple backends for one alias", async () => {
    const req = {
      json: async () => ({
        alias: "deepseek-v4-flash",
        backends: [
          { backendUrl: "http://gpu-1:8000/v1", backendModel: "deepseek-v4" },
          { backendUrl: "http://gpu-2:8000/v1", backendModel: "deepseek-v4" },
        ],
      }),
    };
    const res = await POST(req as never);

    expect(res.status).toBe(201);
    const backendValues = mockInsertValues.mock.calls[1][0];
    expect(backendValues).toHaveLength(2);
  });

  it("rejects an empty backends array", async () => {
    const req = {
      json: async () => ({ alias: "gpt_4.1-mini", backends: [] }),
    };
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("backends");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects a backend with an invalid URL", async () => {
    const req = {
      json: async () => ({
        alias: "gpt_4.1-mini",
        backends: [{ backendUrl: "not-a-url", backendModel: "m" }],
      }),
    };
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("still rejects alias starting with invalid characters", async () => {
    const req = {
      json: async () => ({
        alias: "-bad.alias",
        backends: [
          {
            backendUrl: "https://api.example.com/v1",
            backendModel: "gpt-4.1-mini",
          },
        ],
      }),
    };
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid alias");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("accepts optional remark", async () => {
    const req = {
      json: async () => ({
        alias: "gpt_4.1-mini",
        backends: [
          {
            backendUrl: "https://api.example.com/v1",
            backendModel: "gpt-4.1-mini",
          },
        ],
        remark: "internal model",
      }),
    };
    const res = await POST(req as never);

    expect(res.status).toBe(201);
    const values = mockInsertValues.mock.calls[0][0] as { remark?: string };
    expect(values.remark).toBe("internal model");
  });
});
