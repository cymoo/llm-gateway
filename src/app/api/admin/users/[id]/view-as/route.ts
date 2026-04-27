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

  // Pass the token via URL param; middleware will set the cookie and redirect
  // to a clean URL. This avoids the unreliable Set-Cookie on redirect responses.
  //
  // In production (behind a reverse proxy), req.nextUrl.origin reflects the
  // internal address (e.g. localhost:3000). Read forwarded headers instead to
  // build the correct public-facing redirect URL.
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    "localhost:3000";
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");

  const redirectUrl = new URL("/dashboard", `${proto}://${host}`);
  redirectUrl.searchParams.set("_vt", token);
  return NextResponse.redirect(redirectUrl);
}
