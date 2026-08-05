import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAdminUser, mockSelect } = vi.hoisted(() => ({
  mockGetAdminUser: vi.fn(),
  mockSelect: vi.fn(),
}));

vi.mock("@/app/api/admin/middleware", () => ({
  getAdminUser: mockGetAdminUser,
  unauthorizedResponse: () =>
    Response.json({ error: "Unauthorized" }, { status: 401 }),
  notFoundResponse: (msg: string) =>
    Response.json({ error: msg }, { status: 404 }),
}));

vi.mock("@/lib/db", () => ({ db: { select: mockSelect } }));

import { POST } from "./route";

// First query (the model) resolves at .limit(); the second (its backends)
// resolves at .orderBy().
function setupModel(
  model: Record<string, unknown> | null,
  backends: Record<string, unknown>[] = []
) {
  mockSelect.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(model ? [model] : []),
        orderBy: () => Promise.resolve(backends),
      }),
    }),
  }));
}

function backendRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "backend-1",
    modelId: "id-a",
    backendUrl: "http://backend/v1/",
    backendModel: "gpt-backend",
    backendApiKey: "sk-be",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const params = { params: Promise.resolve({ id: "id-a" }) };
const req = { json: async () => ({}) } as never;

describe("POST /api/admin/models/[id]/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("tests a chat model via POST /chat/completions with the backend model id", async () => {
    setupModel({ id: "id-a", type: "chat" }, [backendRow()]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req, params);
    const body = await res.json();

    expect(body.results).toHaveLength(1);
    expect(body.results[0].status).toBe("ok");
    expect(body.results[0].backendId).toBe("backend-1");
    expect(typeof body.results[0].latency_ms).toBe("number");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://backend/v1/chat/completions");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("gpt-backend");
    expect(sent.messages).toEqual([{ role: "user", content: "ping" }]);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-be");
  });

  it("tests every backend of a multi-backend model", async () => {
    setupModel({ id: "id-a", type: "chat" }, [
      backendRow({ id: "backend-1", backendUrl: "http://gpu-1/v1" }),
      backendRow({ id: "backend-2", backendUrl: "http://gpu-2/v1" }),
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req, params);
    const body = await res.json();

    expect(body.results).toHaveLength(2);
    const byId = Object.fromEntries(
      body.results.map((r: { backendId: string }) => [r.backendId, r])
    );
    expect(byId["backend-1"].status).toBe("ok");
    expect(byId["backend-2"].status).toBe("error");
    expect(byId["backend-2"].message).toContain("503");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tests only the requested backend when backendId is given", async () => {
    setupModel({ id: "id-a", type: "chat" }, [
      backendRow({ id: "backend-1", backendUrl: "http://gpu-1/v1" }),
      backendRow({ id: "backend-2", backendUrl: "http://gpu-2/v1" }),
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const filteredReq = { json: async () => ({ backendId: "backend-2" }) };
    const res = await POST(filteredReq as never, params);
    const body = await res.json();

    expect(body.results).toHaveLength(1);
    expect(body.results[0].backendId).toBe("backend-2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://gpu-2/v1/chat/completions");
  });

  it("404s for a backendId not belonging to the model", async () => {
    setupModel({ id: "id-a", type: "chat" }, [backendRow()]);
    vi.stubGlobal("fetch", vi.fn());

    const filteredReq = { json: async () => ({ backendId: "other" }) };
    const res = await POST(filteredReq as never, params);
    expect(res.status).toBe(404);
  });

  it("tests an embedding model via POST /embeddings (not GET /models)", async () => {
    setupModel({ id: "id-a", type: "embedding" }, [
      backendRow({
        backendUrl: "http://embed/v1",
        backendModel: "bge-m3",
        backendApiKey: null,
      }),
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req, params);
    expect((await res.json()).results[0].status).toBe("ok");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://embed/v1/embeddings");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("bge-m3");
    expect(sent.input).toBe("ping");
    expect(sent.messages).toBeUndefined();
  });

  it("tests a rerank model via POST /rerank with query and documents", async () => {
    setupModel({ id: "id-a", type: "rerank" }, [
      backendRow({
        backendUrl: "http://rerank/v1",
        backendModel: "bge-reranker-v2-m3",
        backendApiKey: null,
      }),
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req, params);
    expect((await res.json()).results[0].status).toBe("ok");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://rerank/v1/rerank");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("bge-reranker-v2-m3");
    expect(sent.query).toBe("ping");
    expect(sent.documents).toEqual(["ping"]);
    expect(sent.messages).toBeUndefined();
    expect(sent.input).toBeUndefined();
  });

  it("surfaces the backend error status and body on failure", async () => {
    setupModel({ id: "id-a", type: "chat" }, [
      backendRow({ backendModel: "missing-model", backendApiKey: null }),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "model not found" } }), {
          status: 404,
          statusText: "Not Found",
        })
      )
    );

    const res = await POST(req, params);
    const body = await res.json();

    expect(body.results[0].status).toBe("error");
    expect(body.results[0].message).toContain("404");
    expect(body.results[0].message).toContain("model not found");
  });

  it("reports a timeout when the probe aborts", async () => {
    setupModel({ id: "id-a", type: "chat" }, [
      backendRow({ backendApiKey: null }),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" })
      )
    );

    const res = await POST(req, params);
    const body = await res.json();
    expect(body.results[0].status).toBe("error");
    expect(body.results[0].message).toBe("Connection timeout");
  });

  it("401s for a non-admin", async () => {
    mockGetAdminUser.mockResolvedValue(null);
    const res = await POST(req, params);
    expect(res.status).toBe(401);
  });
});
