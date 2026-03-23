export type ProxyErrorType =
  | "authentication_error"
  | "permission_error"
  | "not_found_error"
  | "rate_limit_error"
  | "server_error";

export type ProxyErrorCode =
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

interface BackendErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  };
}

export function makeProxyError(
  message: string,
  type: ProxyErrorType,
  code: ProxyErrorCode,
  status: number
): Response {
  return new Response(
    JSON.stringify({
      error: { message, type, code },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export function normalizeBackendError(
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
  if (!error?.message) {
    return null;
  }

  const message = error.message.toLowerCase();
  const code = error.code != null ? String(error.code).toLowerCase() : "";
  const type = error.type != null ? String(error.type).toLowerCase() : "";

  if (
    code === "insufficient_quota" ||
    (message.includes("quota") && message.includes("exceed"))
  ) {
    return makeProxyError(
      "Upstream model service quota exceeded. Please try again later.",
      "rate_limit_error",
      "rate_limit_exceeded",
      429
    );
  }

  if (
    status === 429 ||
    code === "rate_limit_exceeded" ||
    message.includes("rate limit")
  ) {
    return makeProxyError(
      "Upstream model service is rate limited. Please try again later.",
      "rate_limit_error",
      "rate_limit_exceeded",
      429
    );
  }

  if (
    (status === 401 || status === 403) &&
    (code === "invalid_api_key" ||
      type === "authentication_error" ||
      message.includes("invalid api key"))
  ) {
    return makeProxyError(
      "Upstream model service authentication failed. Please contact administrator.",
      "server_error",
      "backend_unavailable",
      502
    );
  }

  return null;
}
