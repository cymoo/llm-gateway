import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInsert, mockInsertValues } = vi.hoisted(() => {
  const insertValues = vi.fn();
  const insert = vi.fn(() => ({ values: insertValues }));
  return {
    mockInsert: insert,
    mockInsertValues: insertValues,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    insert: mockInsert,
  },
}));

import { POST } from "./route";

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertValues.mockResolvedValue(undefined);
  });

  it("creates a pending user with normalized email", async () => {
    const req = {
      json: async () => ({ name: " Alice ", email: "Alice@Example.COM " }),
    };
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.message).toContain("pending admin approval");
    expect(body.data.status).toBe("pending_approval");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    const values = mockInsertValues.mock.calls[0][0];
    expect(values.name).toBe("Alice");
    expect(values.email).toBe("alice@example.com");
    expect(values.isActive).toBe(false);
    expect(values.isAdmin).toBe(false);
    expect(values.apiKey).toBeTypeOf("string");
  });

  it("rejects invalid email", async () => {
    const req = {
      json: async () => ({ name: "Alice", email: "not-an-email" }),
    };
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid email");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns conflict for duplicate email", async () => {
    mockInsertValues.mockRejectedValue(new Error("duplicate key value violates unique constraint"));
    const req = {
      json: async () => ({ name: "Alice", email: "alice@example.com" }),
    };
    const res = await POST(req as never);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("already registered");
  });
});
