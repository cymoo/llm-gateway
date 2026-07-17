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

describe("handleProxy prompt preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckQuota.mockResolvedValue(null);

    let limitCallIndex = 0;
    const limitResults = [
      [{ id: "user-1", isActive: true, groupId: "group-default" }],
      [{ id: "group-default", isDefault: true }],
      [{ id: "model-1", alias: "gpt-test", backendUrl: "http://backend", backendModel: "gpt-backend" }],
      [{ userId: "user-1", modelId: "model-1" }],
    ];

    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(limitResults[limitCallIndex++]),
        }),
      }),
    }));

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

describe("handleProxy embeddings", () => {
  function setupDb(modelRow: Record<string, unknown>) {
    let i = 0;
    const results = [
      [{ id: "user-1", isActive: true, groupId: "group-default" }],
      [{ id: "group-default", isDefault: true }],
      [modelRow],
      [{ userId: "user-1", modelId: "model-1" }],
    ];
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(results[i++]),
        }),
      }),
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckQuota.mockResolvedValue(null);
  });

  it("proxies to /embeddings and records prompt-only usage", async () => {
    setupDb({
      id: "model-1",
      alias: "embed-test",
      backendUrl: "http://backend",
      backendModel: "bge-backend",
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
    setupDb({
      id: "model-1",
      alias: "embed-test",
      backendUrl: "http://backend",
      backendModel: "bge-backend",
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
    setupDb({
      id: "model-1",
      alias: "gpt-test",
      backendUrl: "http://backend",
      backendModel: "gpt-backend",
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
    setupDb({
      id: "model-1",
      alias: "embed-test",
      backendUrl: "http://backend",
      backendModel: "bge-backend",
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
  function setupDb(modelRow: Record<string, unknown>) {
    let i = 0;
    const results = [
      [{ id: "user-1", isActive: true, groupId: "group-default" }],
      [{ id: "group-default", isDefault: true }],
      [modelRow],
      [{ userId: "user-1", modelId: "model-1" }],
    ];
    mockSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(results[i++]),
        }),
      }),
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckQuota.mockResolvedValue(null);
  });

  it("proxies to /rerank and records prompt-only usage from the query", async () => {
    setupDb({
      id: "model-1",
      alias: "rerank-test",
      backendUrl: "http://backend",
      backendModel: "bge-reranker-backend",
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
    setupDb({
      id: "model-1",
      alias: "rerank-test",
      backendUrl: "http://backend",
      backendModel: "bge-reranker-backend",
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
    setupDb({
      id: "model-1",
      alias: "gpt-test",
      backendUrl: "http://backend",
      backendModel: "gpt-backend",
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
    setupDb({
      id: "model-1",
      alias: "rerank-test",
      backendUrl: "http://backend",
      backendModel: "bge-reranker-backend",
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
