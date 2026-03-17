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
