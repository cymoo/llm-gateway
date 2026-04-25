import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { signJWT } from "@/lib/auth/jwt";
import { getAdminUser, unauthorizedResponse, notFoundResponse } from "@/app/api/admin/middleware";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;

  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (rows.length === 0) return notFoundResponse("User not found");

  const user = rows[0];

  const token = await signJWT({
    userId: user.id,
    email: user.email,
    isAdmin: user.isAdmin ?? false,
  });

  const response = NextResponse.redirect(new URL("/dashboard", req.url));
  response.headers.set(
    "Set-Cookie",
    `user_token=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`
  );
  return response;
}
