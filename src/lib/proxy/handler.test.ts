import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockCheckQuota, mockRecordUsage } = vi.hoisted(() => {
  const select = vi.fn();
  return {
    mockSelect: select,
    mockCheckQuota: vi.fn(),
    mockRecordUsage: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    select: mockSelect,
  },
}));

vi.mock("@/lib/quota/checker", () => ({
  checkQuota: mockCheckQuota,
}));

vi.mock("@/lib/usage/recorder", () => ({
  recordUsage: mockRecordUsage,
}));

import { handleProxy } from "./handler";
import { _resetRoundRobin } from "./backends";

// Queue-based drizzle mock. Auth/model/authorization queries resolve at
// `.limit()`; the model_backends query resolves at `.orderBy()`.
function setupDb(results: unknown[][]) {
  let i = 0;
  const next = () => Promise.resolve(results[i++] ?? []);
  mockSelect.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: next,
        orderBy: next,
      }),
    }),
  }));
}

function chatQueue(
  modelRow: Record<string, unknown>,
  backends: Record<string, unknown>[]
) {
  return [
    [{ id: "user-1", isActive: true, groupId: "group-default" }],
    [{ id: "group-default", isDefault: true }],
    [modelRow],
    [{ userId: "user-1", modelId: "model-1" }],
    backends,
  ];
}

const defaultBackend = {
  id: "backend-1",
  modelId: "model-1",
  backendUrl: "http://backend",
  backendModel: "gpt-backend",
  backendApiKey: null,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("handleProxy prompt preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRoundRobin();
    mockCheckQuota.mockResolvedValue(null);

    setupDb(chatQueue({ id: "model-1", alias: "gpt-test" }, [defaultBackend]));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            usage: {
              prompt_tokens: 11,
              completion_tokens: 22,
              total_tokens: 33,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );
  });

  it("records full user message without 500-char truncation", async () => {
    const longPrompt = "a".repeat(800);
    const req = {
      headers: new Headers({
        authorization: "Bearer test-key",
      }),
      json: async () => ({
        model: "gpt-test",
        messages: [{ role: "user", content: longPrompt }],
        stream: false,
      }),
    };

    const res = await handleProxy(req as never, "chat.completions");
    expect(res.status).toBe(200);
    expect(mockRecordUsage).toHaveBeenCalledTimes(1);
    expect(mockRecordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        promptPreview: longPrompt,
      })
    );
  });
});

describe("handleProxy multi-backend", () => {
  const backend1 = {
    ...defaultBackend,
    id: "backend-1",
    backendUrl: "http://backend-1",
    backendModel: "served-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  const backend2 = {
    ...defaultBackend,
    id: "backend-2",
    backendUrl: "http://backend-2",
    backendModel: "served-2",
    createdAt: new Date("2026-01-02T00:00:00Z"),
  };

  const req = () => ({
    headers: new Headers({ authorization: "Bearer test-key" }),
    json: async () => ({
      model: "gpt-test",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRoundRobin();
    mockCheckQuota.mockResolvedValue(null);
  });

  it("returns 503 when the model has no active backends", async () => {
    setupDb(chatQueue({ id: "model-1", alias: "gpt-test" }, []));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleProxy(req() as never, "chat.completions");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("backend_unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("fails over to the other backend on 5xx and records usage once", async () => {
    setupDb(
      chatQueue({ id: "model-1", alias: "gpt-test" }, [backend1, backend2])
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleProxy(req() as never, "chat.completions");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(new Set(urls).size).toBe(2);
    // The forwarded body carries each backend's own served model id.
    const bodies = fetchMock.mock.calls.map((c) =>
      JSON.parse(c[1].body as string)
    );
    expect(new Set(bodies.map((b) => b.model)).size).toBe(2);
    const finalUrl = urls[1];
    const finalBackend = finalUrl.startsWith(backend1.backendUrl)
      ? backend1
      : backend2;
    expect(mockRecordUsage).toHaveBeenCalledTimes(1);
    expect(mockRecordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "model-1",
        totalTokens: 3,
        backendId: finalBackend.id,
        backendUrl: finalBackend.backendUrl,
      })
    );
  });

  it("does not fail over on a 4xx client error", async () => {
    setupDb(
      chatQueue({ id: "model-1", alias: "gpt-test" }, [backend1, backend2])
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "bad" } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleProxy(req() as never, "chat.completions");
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails over for streamed requests when the failure precedes streaming", async () => {
    setupDb(
      chatQueue({ id: "model-1", alias: "gpt-test" }, [backend1, backend2])
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(
        new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const streamReq = {
      headers: new Headers({ authorization: "Bearer test-key" }),
      json: async () => ({
        model: "gpt-test",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    };

    const res = await handleProxy(streamReq as never, "chat.completions");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await res.text();
  });

  it("keeps a conversation on the same backend across turns (affinity)", async () => {
    const fetchOk = () =>
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ usage: { total_tokens: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

    const system = { role: "system", content: "You are helpful." };
    const u1 = { role: "user", content: "first question" };

    const turnReq = (messages: unknown[]) => ({
      headers: new Headers({ authorization: "Bearer test-key" }),
      json: async () => ({ model: "gpt-test", messages, stream: false }),
    });

    setupDb(
      chatQueue({ id: "model-1", alias: "gpt-test" }, [backend1, backend2])
    );
    const fetch1 = fetchOk();
    vi.stubGlobal("fetch", fetch1);
    await handleProxy(turnReq([system, u1]) as never, "chat.completions");

    setupDb(
      chatQueue({ id: "model-1", alias: "gpt-test" }, [backend1, backend2])
    );
    const fetch2 = fetchOk();
    vi.stubGlobal("fetch", fetch2);
    await handleProxy(
      turnReq([
        system,
        u1,
        { role: "assistant", content: "answer" },
        { role: "user", content: "follow-up" },
      ]) as never,
      "chat.completions"
    );

    expect(fetch1.mock.calls[0][0]).toBe(fetch2.mock.calls[0][0]);
  });
});

describe("handleProxy embeddings", () => {
  function setupEmbeddings(
    modelRow: Record<string, unknown>,
    backends: Record<string, unknown>[] = [
      { ...defaultBackend, backendModel: "bge-backend" },
    ]
  ) {
    setupDb(chatQueue(modelRow, backends));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRoundRobin();
    mockCheckQuota.mockResolvedValue(null);
  });

  it("proxies to /embeddings and records prompt-only usage", async () => {
    setupEmbeddings({
      id: "model-1",
      alias: "embed-test",
      type: "embedding",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2] }],
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = {
      headers: new Headers({ authorization: "Bearer test-key" }),
      json: async () => ({ model: "embed-test", input: "hello world" }),
    };

    const res = await handleProxy(req as never, "embeddings");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://backend/embeddings");
    expect(mockRecordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: "embeddings",
        promptTokens: 5,
        completionTokens: 0,
        totalTokens: 5,
        promptPreview: "hello world",
      })
    );
  });

  it("treats a spurious stream:true on embeddings as non-streaming", async () => {
    setupEmbeddings({
      id: "model-1",
      alias: "embed-test",
      type: "embedding",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2] }],
          usage: { prompt_tokens: 5, total_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = {
      headers: new Headers({ authorization: "Bearer test-key" }),
      json: async () => ({
        model: "embed-test",
        input: "hi",
        stream: true,
        stream_options: { include_usage: true },
      }),
    };

    const res = await handleProxy(req as never, "embeddings");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(mockRecordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ requestType: "embeddings", isStream: false, totalTokens: 5 })
    );

    // Streaming controls must not be forwarded to the embeddings backend.
    const forwardedBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(forwardedBody.stream).toBeUndefined();
    expect(forwardedBody.stream_options).toBeUndefined();
    expect(forwardedBody.model).toBe("bge-backend");
  });

  it("rejects an embeddings request against a chat model", async () => {
    setupEmbeddings({
      id: "model-1",
      alias: "gpt-test",
      type: "chat",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = {
      headers: new Headers({ authorization: "Bearer test-key" }),
      json: async () => ({ model: "gpt-test", input: "hello" }),
    };

    const res = await handleProxy(req as never, "embeddings");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("model_type_mismatch");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("rejects a chat request against an embedding model", async () => {
    setupEmbeddings({
      id: "model-1",
      alias: "embed-test",
      type: "embedding",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = {
      headers: new Headers({ authorization: "Bearer test-key" }),
      json: async () => ({
        model: "embed-test",
        messages: [{ role: "user", content: "hi" }],
      }),
    };

    const res = await handleProxy(req as never, "chat.completions");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("model_type_mismatch");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("handleProxy rerank", () => {
  function setupRerank(
    modelRow: Record<string, unknown>,
    backends: Record<string, unknown>[] = [
      { ...defaultBackend, backendModel: "bge-reranker-backend" },
    ]
  ) {
    setupDb(chatQueue(modelRow, backends));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRoundRobin();
    mockCheckQuota.mockResolvedValue(null);
  });

  it("proxies to /rerank and records prompt-only usage from the query", async () => {
    setupRerank({
      id: "model-1",
      alias: "rerank-test",
      type: "rerank",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ index: 0, relevance_score: 0.9 }],
          usage: { prompt_tokens: 7, total_tokens: 7 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = {
      headers: new Headers({ authorization: "Bearer test-key" }),
      json: async () => ({
        model: "rerank-test",
        query: "what is the capital of France?",
        documents: ["Paris is the capital of France.", "Berlin is in Germany."],
      }),
    };

    const res = await handleProxy(req as never, "rerank");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://backend/rerank");
    expect(mockRecordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: "rerank",
        promptTokens: 7,
        completionTokens: 0,
        totalTokens: 7,
        promptPreview: "what is the capital of France?",
      })
    );

    // The gateway rewrites the model but forwards query/documents verbatim.
    const forwardedBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(forwardedBody.model).toBe("bge-reranker-backend");
    expect(forwardedBody.query).toBe("what is the capital of France?");
    expect(forwardedBody.documents).toHaveLength(2);
  });

  it("treats a spurious stream:true on rerank as non-streaming", async () => {
    setupRerank({
      id: "model-1",
      alias: "rerank-test",
      type: "rerank",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ index: 0, relevance_score: 0.9 }],
          usage: { prompt_tokens: 4, total_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const req = {
      headers: new Headers({ authorization: "Bearer test-key" }),
      json: async () => ({
        model: "rerank-test",
        query: "hi",
        documents: ["a", "b"],
        stream: true,
        stream_options: { include_usage: true },
      }),
    };

    const res = await handleProxy(req as never, "rerank");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(mockRecordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ requestType: "rerank", isStream: false, totalTokens: 4 })
    );

    // Streaming controls must not be forwarded to the rerank backend.
    const forwardedBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(forwardedBody.stream).toBeUndefined();
    expect(forwardedBody.stream_options).toBeUndefined();
    expect(forwardedBody.model).toBe("bge-reranker-backend");
  });

  it("rejects a rerank request against a chat model", async () => {
    setupRerank({
      id: "model-1",
      alias: "gpt-test",
      type: "chat",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = {
      headers: new Headers({ authorization: "Bearer test-key" }),
      json: async () => ({ model: "gpt-test", query: "hi", documents: ["a"] }),
    };

    const res = await handleProxy(req as never, "rerank");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("model_type_mismatch");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("rejects a chat request against a rerank model", async () => {
    setupRerank({
      id: "model-1",
      alias: "rerank-test",
      type: "rerank",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = {
      headers: new Headers({ authorization: "Bearer test-key" }),
      json: async () => ({
        model: "rerank-test",
        messages: [{ role: "user", content: "hi" }],
      }),
    };

    const res = await handleProxy(req as never, "chat.completions");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("model_type_mismatch");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
