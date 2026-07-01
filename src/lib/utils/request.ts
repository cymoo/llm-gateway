import { NextRequest } from "next/server";

/**
 * Best-effort client IP extraction from proxy headers.
 * Mirrors the logic previously inlined in the proxy handlers.
 */
export function getClientIp(req: NextRequest): string | null {
  const headers = req?.headers;
  if (!headers?.get) return null;
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    null
  );
}

export function getUserAgent(req: NextRequest): string | null {
  const headers = req?.headers;
  if (!headers?.get) return null;
  return headers.get("user-agent") || null;
}
