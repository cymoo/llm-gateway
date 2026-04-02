import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { signJWT } from "@/lib/auth/jwt";
import bcrypt from "bcryptjs";
import { seedAdmin } from "@/lib/db/seed";

export async function POST(req: NextRequest) {
  await seedAdmin();

  const { email, password } = await req.json();

  if (!email || !password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (userRows.length === 0) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const user = userRows[0];

  if (!user.passwordHash) {
    return Response.json({ error: "Password not set. Please contact admin." }, { status: 403 });
  }

  if (!user.isActive) {
    return Response.json({ error: "Account is not active. Please contact admin." }, { status: 403 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const token = await signJWT({
    userId: user.id,
    email: user.email,
    isAdmin: user.isAdmin ?? false,
  });

  const response = Response.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
    },
  });

  response.headers.set(
    "Set-Cookie",
    `user_token=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`
  );

  return response;
}
