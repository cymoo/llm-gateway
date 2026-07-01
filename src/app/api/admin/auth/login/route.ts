import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { signJWT } from "@/lib/auth/jwt";
import bcrypt from "bcryptjs";
import { seedAdmin } from "@/lib/db/seed";
import { recordAudit } from "@/lib/audit/recorder";

export async function POST(req: NextRequest) {
  await seedAdmin();

  const { email, password } = await req.json();

  if (!email || !password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  const auditFailure = (reason: string, adminId: string | null = null) =>
    recordAudit({
      adminId,
      adminEmail: email,
      action: "auth.login_failed",
      resourceType: "auth",
      resourceLabel: email,
      status: "failure",
      metadata: { reason },
      req,
    });

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (userRows.length === 0) {
    auditFailure("unknown_email");
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const user = userRows[0];

  if (!user.isAdmin || !user.passwordHash) {
    auditFailure("not_admin", user.id);
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  if (!user.isActive) {
    auditFailure("account_disabled", user.id);
    return Response.json({ error: "Account is disabled" }, { status: 403 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    auditFailure("invalid_password", user.id);
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const token = await signJWT({
    userId: user.id,
    email: user.email,
    isAdmin: true,
  });

  recordAudit({
    adminId: user.id,
    adminEmail: user.email,
    action: "auth.login",
    resourceType: "auth",
    resourceLabel: user.email,
    status: "success",
    req,
  });

  const response = Response.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  });

  // Set httpOnly cookie
  response.headers.set(
    "Set-Cookie",
    `admin_token=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`
  );

  return response;
}
