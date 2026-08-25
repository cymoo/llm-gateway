export type AnthropicErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "permission_error"
  | "not_found_error"
  | "rate_limit_error"
  | "server_error";

export type AnthropicErrorCode =
  | "invalid_api_key"
  | "user_disabled"
  | "model_not_allowed"
  | "model_not_found"
  | "daily_token_limit"
  | "daily_request_limit"
  | "rate_limit_exceeded"
  | "time_restricted"
  | "backend_unavailable"
  | "backend_timeout";

export function makeAnthropicError(
  message: string,
  type: AnthropicErrorType,
  status: number
): Response {
  return new Response(
    JSON.stringify({
      type: "error",
      error: { type, message },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

interface BackendErrorPayload {
  type?: string;
  error?: {
    type?: string;
    message?: string;
  };
}

export function normalizeAnthropicBackendError(
  responseText: string,
  status: number
): Response | null {
  let payload: BackendErrorPayload;
  try {
    payload = JSON.parse(responseText) as BackendErrorPayload;
  } catch {
    return null;
  }

  const error = payload.error;
  const message = error?.message || "";
  const errorType = error?.type || "";

  if (
    status === 429 ||
    errorType === "rate_limit_error" ||
    message.toLowerCase().includes("rate limit")
  ) {
    return makeAnthropicError(
      "Upstream model service is rate limited. Please try again later.",
      "rate_limit_error",
      429
    );
  }

  if (
    (status === 401 || status === 403) &&
    (errorType === "authentication_error" ||
      message.toLowerCase().includes("invalid api key"))
  ) {
    return makeAnthropicError(
      "Upstream model service authentication failed. Please contact administrator.",
      "server_error",
      502
    );
  }

  return null;
}
