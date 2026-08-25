import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInsert, mockUsageValues, mockDailyValues, mockUpsert } = vi.hoisted(
  () => ({
    mockInsert: vi.fn(),
    mockUsageValues: vi.fn(),
    mockDailyValues: vi.fn(),
    mockUpsert: vi.fn(),
  })
);

vi.mock("@/lib/db", () => ({
  db: { insert: mockInsert },
}));

import { recordUsage } from "./recorder";

describe("recordUsage backend snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsageValues.mockResolvedValue(undefined);
    mockUpsert.mockResolvedValue(undefined);
    mockDailyValues.mockReturnValue({ onConflictDoUpdate: mockUpsert });
    mockInsert
      .mockReturnValueOnce({ values: mockUsageValues })
      .mockReturnValueOnce({ values: mockDailyValues });
  });

  it("persists the final backend id and URL in the usage log", async () => {
    recordUsage({
      userId: "user-1",
      modelId: "model-1",
      requestType: "chat.completions",
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
      isStream: false,
      durationMs: 42,
      status: "success",
      backendId: "a0b1c2d3-e4f5-4678-9012-abcdefabcdef",
      backendUrl: "http://gpu-1.internal:8000/v1",
    });

    await vi.waitFor(() => expect(mockUsageValues).toHaveBeenCalledTimes(1));
    expect(mockUsageValues).toHaveBeenCalledWith(
      expect.objectContaining({
        backendId: "a0b1c2d3-e4f5-4678-9012-abcdefabcdef",
        backendUrl: "http://gpu-1.internal:8000/v1",
      })
    );
  });
});
