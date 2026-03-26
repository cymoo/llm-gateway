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
      [{ id: "user-1", isActive: true }],
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
