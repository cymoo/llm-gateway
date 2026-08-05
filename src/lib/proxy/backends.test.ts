import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));

import {
  affinityKey,
  anthropicAffinityKey,
  orderBackendsForRequest,
  isFailoverEligibleStatus,
  forwardWithFailover,
  _resetRoundRobin,
} from "./backends";
import type { ModelBackend } from "@/lib/db/schema";

function backend(id: string, createdAt: string): ModelBackend {
  return {
    id,
    modelId: "model-1",
    backendUrl: `http://${id}`,
    backendModel: `served-${id}`,
    backendApiKey: null,
    isActive: true,
    createdAt: new Date(createdAt),
  };
}

const b1 = backend("b1", "2026-01-01T00:00:00Z");
const b2 = backend("b2", "2026-01-02T00:00:00Z");
const b3 = backend("b3", "2026-01-03T00:00:00Z");

describe("affinityKey", () => {
  it("is stable across turns of the same conversation", async () => {
    const system = { role: "system", content: "You are a helpful assistant." };
    const u1 = { role: "user", content: "What is the capital of France?" };
    const turn1 = affinityKey("chat.completions", { messages: [system, u1] });
    const turn2 = affinityKey("chat.completions", {
      messages: [
        system,
        u1,
        { role: "assistant", content: "Paris." },
        { role: "user", content: "And of Germany?" },
      ],
    });
    expect(turn1).not.toBeNull();
    expect(turn2).toBe(turn1);
  });

  it("is stable across turns without a system prompt", () => {
    const u1 = { role: "user", content: "hello" };
    const turn1 = affinityKey("chat.completions", { messages: [u1] });
    const turn2 = affinityKey("chat.completions", {
      messages: [u1, { role: "assistant", content: "hi" }, { role: "user", content: "more" }],
    });
    expect(turn2).toBe(turn1);
  });

  it("differs between conversations with different first user messages", () => {
    const system = { role: "system", content: "shared prompt" };
    const a = affinityKey("chat.completions", {
      messages: [system, { role: "user", content: "question A" }],
    });
    const b = affinityKey("chat.completions", {
      messages: [system, { role: "user", content: "question B" }],
    });
    expect(a).not.toBe(b);
  });

  it("uses the prompt for completions requests", () => {
    expect(affinityKey("completions", { prompt: "once upon a time" })).toBe(
      "once upon a time"
    );
    expect(
      affinityKey("completions", { prompt: ["p1", "p2"] })
    ).not.toBeNull();
  });

  it("returns null for embeddings, rerank, and malformed bodies", () => {
    expect(affinityKey("embeddings", { input: "x" })).toBeNull();
    expect(affinityKey("rerank", { query: "x" })).toBeNull();
    expect(affinityKey("chat.completions", {})).toBeNull();
    expect(affinityKey("chat.completions", { messages: [] })).toBeNull();
    expect(affinityKey("completions", {})).toBeNull();
  });
});

describe("anthropicAffinityKey", () => {
  it("is stable across turns and keyed by system + first message", () => {
    const first = { role: "user", content: "hi" };
    const turn1 = anthropicAffinityKey({ system: "sys", messages: [first] });
    const turn2 = anthropicAffinityKey({
      system: "sys",
      messages: [first, { role: "assistant", content: "hello" }],
    });
    expect(turn2).toBe(turn1);
    expect(
      anthropicAffinityKey({ system: "other", messages: [first] })
    ).not.toBe(turn1);
  });

  it("returns null without messages", () => {
    expect(anthropicAffinityKey({})).toBeNull();
    expect(anthropicAffinityKey({ messages: [] })).toBeNull();
  });
});

describe("orderBackendsForRequest", () => {
  beforeEach(() => _resetRoundRobin());

  it("round-robins when no affinity key is given", () => {
    const first = orderBackendsForRequest("model-1", [b1, b2, b3], null);
    const second = orderBackendsForRequest("model-1", [b1, b2, b3], null);
    const third = orderBackendsForRequest("model-1", [b1, b2, b3], null);
    const fourth = orderBackendsForRequest("model-1", [b1, b2, b3], null);
    expect(first.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(second.map((b) => b.id)).toEqual(["b2", "b3", "b1"]);
    expect(third.map((b) => b.id)).toEqual(["b3", "b1", "b2"]);
    expect(fourth.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("orders deterministically for the same affinity key", () => {
    const a = orderBackendsForRequest("model-1", [b1, b2, b3], "conv-key");
    const b = orderBackendsForRequest("model-1", [b1, b2, b3], "conv-key");
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });

  it("distributes different keys across backends", () => {
    const firstPicks = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const ordered = orderBackendsForRequest(
        "model-1",
        [b1, b2, b3],
        `conversation-${i}`
      );
      firstPicks.add(ordered[0].id);
    }
    // With 50 distinct keys over 3 backends, every backend should be the
    // top pick for at least one key.
    expect(firstPicks.size).toBe(3);
  });

  it("keeps unaffected mappings when a backend is removed (HRW property)", () => {
    for (let i = 0; i < 50; i++) {
      const key = `conversation-${i}`;
      const before = orderBackendsForRequest("model-1", [b1, b2, b3], key);
      if (before[0].id === "b2") continue; // remapped by necessity
      const after = orderBackendsForRequest("model-1", [b1, b3], key);
      expect(after[0].id).toBe(before[0].id);
    }
  });

  it("returns a copy for a single backend", () => {
    const input = [b1];
    const out = orderBackendsForRequest("model-1", input, "key");
    expect(out).toEqual([b1]);
    expect(out).not.toBe(input);
  });
});

describe("isFailoverEligibleStatus", () => {
  it("retries on 5xx and 429 but not on other 4xx", () => {
    expect(isFailoverEligibleStatus(500)).toBe(true);
    expect(isFailoverEligibleStatus(503)).toBe(true);
    expect(isFailoverEligibleStatus(429)).toBe(true);
    expect(isFailoverEligibleStatus(400)).toBe(false);
    expect(isFailoverEligibleStatus(401)).toBe(false);
    expect(isFailoverEligibleStatus(404)).toBe(false);
  });
});

describe("forwardWithFailover", () => {
  const buildRequest = (b: ModelBackend) => ({
    url: `${b.backendUrl}/chat/completions`,
    init: { method: "POST" as const, body: "{}" },
  });

  afterEach(() => vi.unstubAllGlobals());

  it("tries the next backend after a connect error", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await forwardWithFailover({
      backends: [b1, b2],
      buildRequest,
      timeoutMs: 1000,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect(outcome.backend.id).toBe("b2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("http://b2/chat/completions");
  });

  it("tries the next backend after a 500 without consuming the good response body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(
        new Response("data: chunk\n\n", { status: 200 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await forwardWithFailover({
      backends: [b1, b2],
      buildRequest,
      timeoutMs: 1000,
    });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.response.bodyUsed).toBe(false);
      expect(await outcome.response.text()).toBe("data: chunk\n\n");
    }
  });

  it("returns a non-retryable 4xx immediately without trying other backends", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await forwardWithFailover({
      backends: [b1, b2],
      buildRequest,
      timeoutMs: 1000,
    });

    expect(outcome).toMatchObject({ kind: "http_error", status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns timeout immediately without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" })
      );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await forwardWithFailover({
      backends: [b1, b2],
      buildRequest,
      timeoutMs: 1000,
    });

    expect(outcome.kind).toBe("timeout");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the last http error when every backend fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("first", { status: 500 }))
      .mockResolvedValueOnce(new Response("second", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await forwardWithFailover({
      backends: [b1, b2],
      buildRequest,
      timeoutMs: 1000,
    });

    expect(outcome).toMatchObject({
      kind: "http_error",
      status: 503,
      text: "second",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns network_error when every backend is unreachable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await forwardWithFailover({
      backends: [b1, b2, b3],
      buildRequest,
      timeoutMs: 1000,
    });

    expect(outcome.kind).toBe("network_error");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
