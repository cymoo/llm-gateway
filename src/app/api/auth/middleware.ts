import { NextRequest } from "next/server";
import { verifyJWT, JWTPayload } from "@/lib/auth/jwt";

export async function getAuthUser(req: NextRequest): Promise<JWTPayload | null> {
  const token = req.cookies.get("user_token")?.value;
  if (!token) return null;

  const payload = await verifyJWT(token);
  if (!payload) return null;

  return payload;
}

export function unauthorizedResponse() {
  return new Response(
    JSON.stringify({ error: "Unauthorized" }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );
}
