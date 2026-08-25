import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockCatalog } = vi.hoisted(() => ({ mockCatalog: vi.fn() }));

vi.mock("@/lib/models/catalog", () => ({
  getAuthorizedModelCatalog: mockCatalog,
}));

vi.mock("@/lib/proxy/anthropic-handler", () => ({
  handleAnthropicProxy: vi.fn(),
}));

import { GET } from "./route";

const context = (path: string[]) => ({
  params: Promise.resolve({ path }),
});

const request = (query = "", headers: HeadersInit = { "x-api-key": "test-key" }) =>
  new NextRequest(`http://localhost/api/anthropic/v1/models${query}`, {
    headers,
  });

const catalog = [
  {
    id: "id-old",
    alias: "model-old",
    type: "chat",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  },
  {
    id: "id-new",
    alias: "model-new",
    type: "chat",
    createdAt: new Date("2026-02-01T00:00:00Z"),
    maxModelLen: 131072,
  },
  {
    id: "id-embedding",
    alias: "embed-model",
    type: "embedding",
    createdAt: new Date("2026-03-01T00:00:00Z"),
  },
];

describe("GET /api/anthropic/v1/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCatalog.mockResolvedValue(catalog);
  });

  it("returns authorized models in Anthropic format, newest first", async () => {
    const res = await GET(request(), context(["v1", "models"]));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockCatalog).toHaveBeenCalledWith("test-key");
    expect(body.data).toHaveLength(2);
    expect(body).toEqual({
      data: [
        {
          id: "model-new",
          type: "model",
          display_name: "model-new",
          created_at: "2026-02-01T00:00:00.000Z",
          max_input_tokens: 131072,
          max_tokens: null,
          capabilities: null,
        },
        {
          id: "model-old",
          type: "model",
          display_name: "model-old",
          created_at: "2026-01-01T00:00:00.000Z",
          max_input_tokens: null,
          max_tokens: null,
          capabilities: null,
        },
      ],
      has_more: false,
      first_id: "model-new",
      last_id: "model-old",
    });
  });

  it("accepts bearer auth and supports cursor pagination", async () => {
    const res = await GET(
      request("?after_id=model-new&limit=1", {
        authorization: "Bearer bearer-key",
      }),
      context(["v1", "models"])
    );
    const body = await res.json();

    expect(mockCatalog).toHaveBeenCalledWith("bearer-key");
    expect(body.data.map((model: { id: string }) => model.id)).toEqual([
      "model-old",
    ]);
    expect(body.has_more).toBe(false);
  });

  it("returns Anthropic authentication errors", async () => {
    mockCatalog.mockResolvedValue(null);
    const res = await GET(request(), context(["v1", "models"]));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      type: "error",
      error: { type: "authentication_error", message: "Invalid API key" },
    });
  });

  it("rejects invalid pagination instead of silently ignoring it", async () => {
    const res = await GET(request("?limit=0"), context(["v1", "models"]));

    expect(res.status).toBe(400);
    expect((await res.json()).error.type).toBe("invalid_request_error");
  });

  it("preserves the method error for unsupported GET paths", async () => {
    const res = await GET(request(), context(["v1", "messages"]));

    expect(res.status).toBe(405);
    expect(mockCatalog).not.toHaveBeenCalled();
  });
});
