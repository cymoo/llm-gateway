import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { POST as transcribe } from "@/app/api/v1/audio/transcriptions/route";

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

describe("POST /api/v1/audio/transcriptions", () => {
  const audioModel = { id: "model-1", alias: "qwen-asr", type: "audio" };
  const audioBackend = {
    ...defaultBackend,
    backendUrl: "http://backend/v1/",
    backendModel: "Qwen/Qwen3-ASR-1.7B",
    backendApiKey: "upstream-key",
  };
  const url = "http://gateway/api/v1/audio/transcriptions";
  const audio = new File([new Uint8Array([0, 128, 255])], "clip.wav", {
    type: "audio/wav",
  });
  const fetchMock = vi.fn();

  function request(body: FormData | string) {
    return new Request(url, {
      method: "POST",
      headers: { authorization: "Bearer test-key" },
      body,
    }) as Parameters<typeof transcribe>[0];
  }

  function form() {
    const body = new FormData();
    body.set("model", "qwen-asr");
    body.set("file", audio);
    return body;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    _resetRoundRobin();
    mockCheckQuota.mockResolvedValue(null);
    setupDb(chatQueue(audioModel, [audioBackend]));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("replays the original file and form fields with each backend's model and key", async () => {
    const backup = {
      ...audioBackend,
      id: "backend-2",
      backendUrl: "http://backup/v1",
      backendModel: "backup-asr",
      backendApiKey: null,
    };
    setupDb(chatQueue(audioModel, [audioBackend, backup]));
    const responseBody = { text: "你好", usage: { type: "duration", seconds: 1 } };
    fetchMock
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json(responseBody));
    const body = form();
    body.set("prompt", "one-off term");
    body.set("language", "zh");
    body.append("timestamp_granularities[]", "word");
    body.append("timestamp_granularities[]", "segment");

    const response = await transcribe(request(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [index, [target, init]] of fetchMock.mock.calls.entries()) {
      expect(target).toBe(index === 0
        ? "http://backend/v1/audio/transcriptions"
        : "http://backup/v1/audio/transcriptions");
      // Use Fetch's serializer/parser to verify the generated multipart boundary.
      const upstream = new Request(target, init);
      expect(upstream.headers.get("authorization")).toBe(index === 0 ? "Bearer upstream-key" : null);
      const sent = await upstream.formData();
      expect(sent.get("model")).toBe(index === 0 ? audioBackend.backendModel : "backup-asr");
      expect(sent.get("language")).toBe("zh");
      expect(sent.get("prompt")).toBe("one-off term");
      expect(sent.getAll("timestamp_granularities[]")).toEqual(["word", "segment"]);
      const file = sent.get("file") as File;
      expect(file.name).toBe("clip.wav");
      expect(file.type).toBe("audio/wav");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0, 128, 255]));
    }
    expect(mockRecordUsage).toHaveBeenCalledTimes(1);
    expect(mockRecordUsage).toHaveBeenCalledWith(expect.objectContaining({
      requestType: "audio.transcriptions",
      backendId: "backend-2",
      totalTokens: 0,
      promptPreview: null,
    }));
  });

  it("preserves a plain-text response", async () => {
    fetchMock.mockResolvedValue(new Response("hello", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }));
    const body = form();
    body.set("response_format", "text");

    const response = await transcribe(request(body));

    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe("hello");
  });

  it("uses a fallback after an upstream disconnects during the transcript", async () => {
    const backup = { ...audioBackend, id: "backend-2", backendUrl: "http://backup/v1" };
    setupDb(chatQueue(audioModel, [audioBackend, backup]));
    const truncated = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"text":"partial'));
      },
      pull(controller) {
        controller.error(new TypeError("terminated"));
      },
    }));
    fetchMock
      .mockResolvedValueOnce(truncated)
      .mockResolvedValueOnce(Response.json({ text: "complete" }));

    const response = await transcribe(request(form()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "complete" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ backendId: "backend-2", requestType: "audio.transcriptions" }),
    );
  });

  it("rejects invalid uploads before forwarding", async () => {
    const empty = form();
    empty.set("file", new File([], "empty.wav"));
    const duplicate = form();
    duplicate.append("file", audio);
    const stream = form();
    stream.set("stream", "true");
    const missingModel = form();
    missingModel.delete("model");

    for (const body of ["{}", empty, duplicate, stream, missingModel]) {
      setupDb(chatQueue(audioModel, [audioBackend]));
      expect((await transcribe(request(body))).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an audio file just over 25 MiB", async () => {
    const body = form();
    body.set("file", new Blob([new Uint8Array(25 * 1024 * 1024 + 1)]), "large.wav");

    expect((await transcribe(request(body))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bounds the multipart body even without a Content-Length header", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const cancel = vi.fn();
    const body = new ReadableStream({ pull: (controller) => controller.enqueue(chunk), cancel });
    const req = new Request(url, {
      method: "POST",
      headers: {
        authorization: "Bearer test-key",
        "content-type": "multipart/form-data; boundary=audio",
      },
      body,
      duplex: "half",
    } as RequestInit) as Parameters<typeof transcribe>[0];

    expect((await transcribe(req)).status).toBe(413);
    expect(cancel).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces model type, grants and quotas before forwarding", async () => {
    setupDb(chatQueue({ ...audioModel, type: "chat" }, [audioBackend]));
    expect((await transcribe(request(form()))).status).toBe(404);

    const denied = chatQueue(audioModel, [audioBackend]);
    denied[3] = [];
    setupDb(denied);
    expect((await transcribe(request(form()))).status).toBe(403);

    setupDb(chatQueue(audioModel, [audioBackend]));
    mockCheckQuota.mockResolvedValueOnce(Response.json({}, { status: 429 }));
    expect((await transcribe(request(form()))).status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

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

describe("handleProxy overlapping authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRoundRobin();
    mockCheckQuota.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ usage: { total_tokens: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  });

  it("passes both group and personal sources to quota enforcement", async () => {
    setupDb([
      [{ id: "user-1", isActive: true, groupId: "group-1" }],
      [{ id: "group-1", isDefault: false }],
      [{ id: "model-1", alias: "gpt-test" }],
      [{ groupId: "group-1", modelId: "model-1" }],
      [{ userId: "user-1", modelId: "model-1" }],
      [defaultBackend],
    ]);
    const req = {
      headers: new Headers({ authorization: "Bearer test-key" }),
      json: async () => ({
        model: "gpt-test",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
    };

    const res = await handleProxy(req as never, "chat.completions");

    expect(res.status).toBe(200);
    expect(mockCheckQuota).toHaveBeenCalledWith(
      expect.objectContaining({
        access: { viaUser: true, groupId: "group-1" },
      }),
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
