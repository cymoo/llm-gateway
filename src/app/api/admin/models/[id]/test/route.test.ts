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

function setupModel(model: Record<string, unknown> | null) {
  mockSelect.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(model ? [model] : []),
      }),
    }),
  }));
}

const params = { params: Promise.resolve({ id: "id-a" }) };
const req = {} as never;

describe("POST /api/admin/models/[id]/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminUser.mockResolvedValue({ userId: "admin-1" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("tests a chat model via POST /chat/completions with the backend model id", async () => {
    setupModel({
      id: "id-a",
      type: "chat",
      backendUrl: "http://backend/v1/",
      backendModel: "gpt-backend",
      backendApiKey: "sk-be",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req, params);
    const body = await res.json();

    expect(body.status).toBe("ok");
    expect(typeof body.latency_ms).toBe("number");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://backend/v1/chat/completions");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("gpt-backend");
    expect(sent.messages).toEqual([{ role: "user", content: "ping" }]);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-be");
  });

  it("tests an embedding model via POST /embeddings (not GET /models)", async () => {
    setupModel({
      id: "id-a",
      type: "embedding",
      backendUrl: "http://embed/v1",
      backendModel: "bge-m3",
      backendApiKey: null,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req, params);
    expect((await res.json()).status).toBe("ok");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://embed/v1/embeddings");
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe("bge-m3");
    expect(sent.input).toBe("ping");
    expect(sent.messages).toBeUndefined();
  });

  it("tests a rerank model via POST /rerank with query and documents", async () => {
    setupModel({
      id: "id-a",
      type: "rerank",
      backendUrl: "http://rerank/v1",
      backendModel: "bge-reranker-v2-m3",
      backendApiKey: null,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req, params);
    expect((await res.json()).status).toBe("ok");

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
    setupModel({
      id: "id-a",
      type: "chat",
      backendUrl: "http://backend/v1",
      backendModel: "missing-model",
    });
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

    expect(body.status).toBe("error");
    expect(body.message).toContain("404");
    expect(body.message).toContain("model not found");
  });

  it("reports a timeout when the probe aborts", async () => {
    setupModel({
      id: "id-a",
      type: "chat",
      backendUrl: "http://backend/v1",
      backendModel: "m",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" })
      )
    );

    const res = await POST(req, params);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toBe("Connection timeout");
  });

  it("401s for a non-admin", async () => {
    mockGetAdminUser.mockResolvedValue(null);
    const res = await POST(req, params);
    expect(res.status).toBe(401);
  });
});
