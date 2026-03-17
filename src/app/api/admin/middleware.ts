import { NextRequest } from "next/server";
import { verifyJWT, JWTPayload } from "@/lib/auth/jwt";

export async function getAdminUser(req: NextRequest): Promise<JWTPayload | null> {
  const token = req.cookies.get("admin_token")?.value;
  if (!token) return null;
  
  const payload = await verifyJWT(token);
  if (!payload || !payload.isAdmin) return null;
  
  return payload;
}

export function unauthorizedResponse() {
  return new Response(
    JSON.stringify({ error: "Unauthorized" }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );
}

export function forbiddenResponse() {
  return new Response(
    JSON.stringify({ error: "Forbidden" }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}

export function notFoundResponse(message = "Not found") {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
}

export function badRequestResponse(message: string) {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
}
