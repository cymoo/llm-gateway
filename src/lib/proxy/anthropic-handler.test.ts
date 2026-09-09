import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockCheckQuota, mockRecordUsage } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockCheckQuota: vi.fn(),
  mockRecordUsage: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { select: mockSelect } }));
vi.mock("@/lib/quota/checker", () => ({ checkQuota: mockCheckQuota }));
vi.mock("@/lib/usage/recorder", () => ({ recordUsage: mockRecordUsage }));

import { handleAnthropicProxy } from "./anthropic-handler";
import { _resetRoundRobin } from "./backends";

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

const backend = {
  id: "backend-1",
  modelId: "model-1",
  backendUrl: "http://backend/v1",
  backendModel: "claude-backend",
  backendApiKey: null,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const req = {
  method: "POST",
  headers: new Headers({ "x-api-key": "test-key" }),
  json: async () => ({
    model: "claude-test",
    messages: [{ role: "user", content: "hi" }],
    stream: false,
  }),
};

describe("handleAnthropicProxy authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRoundRobin();
    mockCheckQuota.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            usage: { input_tokens: 1, output_tokens: 2 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  });

  it("retains both group and personal sources for overlapping access", async () => {
    setupDb([
      [{ id: "user-1", isActive: true, groupId: "group-1" }],
      [{ id: "group-1", isDefault: false }],
      [{ id: "model-1", alias: "claude-test" }],
      [{ groupId: "group-1", modelId: "model-1" }],
      [{ userId: "user-1", modelId: "model-1" }],
      [backend],
    ]);

    const res = await handleAnthropicProxy(req as never, "v1/messages");

    expect(res.status).toBe(200);
    expect(mockCheckQuota).toHaveBeenCalledWith(
      expect.objectContaining({
        access: { viaUser: true, groupId: "group-1" },
      }),
    );
  });

  it("allows a personal-only model for a non-default group user", async () => {
    setupDb([
      [{ id: "user-1", isActive: true, groupId: "group-1" }],
      [{ id: "group-1", isDefault: false }],
      [{ id: "model-1", alias: "claude-test" }],
      [],
      [{ userId: "user-1", modelId: "model-1" }],
      [backend],
    ]);

    const res = await handleAnthropicProxy(req as never, "v1/messages");

    expect(res.status).toBe(200);
    expect(mockCheckQuota).toHaveBeenCalledWith(
      expect.objectContaining({
        access: expect.objectContaining({ viaUser: true }),
      }),
    );
  });
});
