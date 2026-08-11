import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The delete path is reconstructed from a tx mock that records the order of
 * the statements it receives. Usage rows are written after the proxy response
 * (see recordUsage), so the model row must be locked before the cleanup runs
 * and the whole thing must sit in one transaction — otherwise a racing usage
 * insert fails the delete while the already-committed cleanup has destroyed
 * that model's usage history.
 */
const { mockGetAdminUser, mockTransaction, calls, txState } = vi.hoisted(() => {
  const order: string[] = [];
  const state = {
    lockedRows: [{ id: "model-1" }] as Array<{ id: string }>,
    deletedRows: [{ id: "model-1", alias: "gpt_4.1-mini" }] as unknown[],
    throwOnModelDelete: null as unknown,
  };

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: (strength: string) => ({
            limit: async () => {
              order.push(`select.for:${strength}`);
              return state.lockedRows;
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          order.push("update:usage_logs");
        },
      }),
    }),
    delete: (table: unknown) => {
      const name = (table as Record<symbol, string>)[
        Symbol.for("drizzle:Name")
      ];
      return {
        where: () => ({
          // Awaited directly (daily_usage) …
          then: (resolve: (v: unknown) => unknown) => {
            order.push(`delete:${name}`);
            return Promise.resolve().then(resolve);
          },
          // … or chained with returning() (models).
          returning: async () => {
            order.push(`delete:${name}`);
            if (state.throwOnModelDelete) throw state.throwOnModelDelete;
            return state.deletedRows;
          },
        }),
      };
    },
  };

  return {
    mockGetAdminUser: vi.fn(),
    mockTransaction: vi.fn(
      async (fn: (t: typeof tx) => Promise<unknown>) => await fn(tx)
    ),
    calls: order,
    txState: state,
  };
});

vi.mock("@/app/api/admin/middleware", () => ({
  getAdminUser: mockGetAdminUser,
  unauthorizedResponse: () =>
    Response.json({ error: "Unauthorized" }, { status: 401 }),
  notFoundResponse: (message = "Not found") =>
    Response.json({ error: message }, { status: 404 }),
}));

vi.mock("@/lib/db", () => ({
  db: { transaction: mockTransaction },
}));

vi.mock("@/lib/audit/recorder", () => ({
  recordAudit: vi.fn(),
  diff: vi.fn(() => ({})),
}));

import { DELETE } from "./route";

const req = { headers: new Headers() } as never;
const params = { params: Promise.resolve({ id: "model-1" }) };

describe("DELETE /api/admin/models/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    txState.lockedRows = [{ id: "model-1" }];
    txState.deletedRows = [{ id: "model-1", alias: "gpt_4.1-mini" }];
    txState.throwOnModelDelete = null;
    mockGetAdminUser.mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
    });
  });

  it("deletes the model, its usage cleanup and the row in one transaction", async () => {
    const res = await DELETE(req, params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("locks the model row before clearing usage rows", async () => {
    await DELETE(req, params);

    expect(calls[0]).toBe("select.for:update");
    expect(calls).toEqual([
      "select.for:update",
      "update:usage_logs",
      "delete:daily_usage",
      "delete:models",
    ]);
  });

  it("404s without touching usage rows when the model is gone", async () => {
    txState.lockedRows = [];

    const res = await DELETE(req, params);

    expect(res.status).toBe(404);
    expect(calls).toEqual(["select.for:update"]);
  });

  it("reports a foreign key violation as a 409 with a JSON body", async () => {
    txState.throwOnModelDelete = Object.assign(new Error("fk"), {
      code: "23503",
    });

    const res = await DELETE(req, params);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("linked records");
  });

  it("rethrows unrelated database errors", async () => {
    txState.throwOnModelDelete = Object.assign(new Error("boom"), {
      code: "08006",
    });

    await expect(DELETE(req, params)).rejects.toThrow("boom");
  });
});
