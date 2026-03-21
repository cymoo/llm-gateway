import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetAdminUser,
  mockSelect,
  mockFrom,
  mockLeftJoin,
  mockWhere,
  mockOrderBy,
} = vi.hoisted(() => {
  const orderBy = vi.fn();
  const where = vi.fn(() => ({ orderBy }));
  const leftJoin = vi.fn(() => ({ leftJoin, where }));
  const from = vi.fn(() => ({ leftJoin }));
  const select = vi.fn(() => ({ from }));

  return {
    mockGetAdminUser: vi.fn(),
    mockSelect: select,
    mockFrom: from,
    mockLeftJoin: leftJoin,
    mockWhere: where,
    mockOrderBy: orderBy,
  };
});

vi.mock("@/app/api/admin/middleware", () => ({
  getAdminUser: mockGetAdminUser,
  unauthorizedResponse: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
  },
}));

import { GET } from "./route";

describe("GET /api/admin/usage/logs?format=csv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
    mockOrderBy.mockResolvedValue([
      {
        id: "log-1",
        userName: "=sum(1,2)",
        modelAlias: "gpt-4.1",
        requestType: "chat.completions",
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        isStream: true,
        durationMs: 100,
        status: "success",
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
      },
    ]);
  });

  it("returns csv attachment with escaped values", async () => {
    const req = {
      url: "http://localhost/api/admin/usage/logs?startDate=2026-01-01&endDate=2026-01-31&format=csv",
    };
    const res = await GET(req as never);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(
      'attachment; filename="usage-logs-2026-01-01-2026-01-31.csv"'
    );
    expect(body).toContain("id,time,user,model,type,prompt_tokens,completion_tokens,total_tokens,stream,duration_ms,status");
    expect(body).toContain('"log-1","2026-01-02T03:04:05.000Z","\'=sum(1,2)","gpt-4.1","chat.completions","10","20","30","true","100","success"');
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockLeftJoin).toHaveBeenCalledTimes(2);
    expect(mockWhere).toHaveBeenCalledTimes(1);
    expect(mockOrderBy).toHaveBeenCalledTimes(1);
  });
});
