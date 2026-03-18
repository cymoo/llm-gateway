import { describe, expect, it } from "vitest";
import { normalizeBackendError } from "./errors";

describe("normalizeBackendError", () => {
  it("maps misleading upstream invalid_api_key auth error to friendly backend auth error", async () => {
    const res = normalizeBackendError(
      JSON.stringify({
        error: {
          message: "Invalid API key",
          type: "authentication_error",
          code: "invalid_api_key",
        },
      }),
      401
    );

    expect(res).not.toBeNull();
    expect(res?.status).toBe(502);
    await expect(res?.json()).resolves.toEqual({
      error: {
        message:
          "Upstream model service authentication failed. Please contact administrator.",
        type: "server_error",
        code: "backend_unavailable",
      },
    });
  });

  it("maps upstream quota errors to friendly quota-exceeded message", async () => {
    const res = normalizeBackendError(
      JSON.stringify({
        error: {
          message:
            "You exceeded your current quota, please check your plan and billing details.",
          type: "insufficient_quota",
          code: "insufficient_quota",
        },
      }),
      429
    );

    expect(res).not.toBeNull();
    expect(res?.status).toBe(429);
    await expect(res?.json()).resolves.toEqual({
      error: {
        message: "Upstream model service quota exceeded. Please try again later.",
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      },
    });
  });

  it("returns null for unknown or non-json backend errors", () => {
    expect(normalizeBackendError("not json", 502)).toBeNull();
    expect(
      normalizeBackendError(
        JSON.stringify({
          error: { message: "some other upstream failure", type: "server_error" },
        }),
        500
      )
    ).toBeNull();
  });
});
