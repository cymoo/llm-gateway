import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractContextWindow,
  getBackendContextWindows,
  _resetContextWindowCache,
} from "./context-window";

describe("extractContextWindow", () => {
  it("prefers the most-specific field when several are present", () => {
    // max_model_len (vLLM) wins over context_length (OpenRouter/Together).
    expect(
      extractContextWindow({ max_model_len: 8192, context_length: 128000 })
    ).toBe(8192);
  });

  it("falls through to less-specific fields", () => {
    expect(extractContextWindow({ context_length: 32768 })).toBe(32768);
    expect(extractContextWindow({ max_context_length: 4096 })).toBe(4096);
  });

  it("coerces numeric strings and floors them", () => {
    expect(extractContextWindow({ context_window: "16384" })).toBe(16384);
    expect(extractContextWindow({ max_model_len: 8192.9 })).toBe(8192);
  });

  it("ignores non-positive, non-numeric, or absent values", () => {
    expect(extractContextWindow({ max_model_len: 0 })).toBeUndefined();
    expect(extractContextWindow({ max_model_len: -1 })).toBeUndefined();
    expect(extractContextWindow({ max_model_len: "n/a" })).toBeUndefined();
    expect(extractContextWindow({ id: "x" })).toBeUndefined();
  });
});

describe("getBackendContextWindows", () => {
  beforeEach(() => {
    _resetContextWindowCache();
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(impl: () => Promise<Response> | Response) {
    const fn = vi.fn().mockImplementation(impl);
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("maps backend model id -> window and sends the backend api key", async () => {
    const fetchMock = stubFetch(() =>
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "gpt-oss-120b", max_model_len: 131072 },
            { id: "embed-1", context_length: 8192 },
            { id: "no-window" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const map = await getBackendContextWindows("http://vllm:8000/v1/", "sk-be");

    expect(map.get("gpt-oss-120b")).toBe(131072);
    expect(map.get("embed-1")).toBe(8192);
    expect(map.has("no-window")).toBe(false);

    const [url, init] = fetchMock.mock.calls[0];
    // Trailing slash normalized away before appending /models.
    expect(url).toBe("http://vllm:8000/v1/models");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-be"
    );
  });

  it("caches per backend so repeated calls probe once", async () => {
    const fetchMock = stubFetch(() =>
      new Response(JSON.stringify({ data: [{ id: "m", max_model_len: 4096 }] }), {
        status: 200,
      })
    );

    await getBackendContextWindows("http://backend/v1");
    await getBackendContextWindows("http://backend/v1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("degrades to an empty map when the backend errors", async () => {
    stubFetch(() => new Response("nope", { status: 500 }));
    const map = await getBackendContextWindows("http://down/v1");
    expect(map.size).toBe(0);
  });

  it("degrades to an empty map when fetch throws", async () => {
    stubFetch(() => Promise.reject(new Error("ECONNREFUSED")));
    const map = await getBackendContextWindows("http://unreachable/v1");
    expect(map.size).toBe(0);
  });

  it("returns an empty map without fetching for a missing backend url", async () => {
    const fetchMock = stubFetch(() => new Response("{}", { status: 200 }));
    const map = await getBackendContextWindows(undefined);
    expect(map.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
