import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { generateApiKey } from "@/lib/utils/api-key";
import { validateEmail, validateAdminPassword } from "@/lib/utils/validators";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const { name, email, password } = await req.json();

  const normalizedName = typeof name === "string" ? name.trim() : "";
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedName || !normalizedEmail) {
    return Response.json({ error: "Name and email are required" }, { status: 400 });
  }

  if (normalizedName.length > 100 || normalizedEmail.length > 255) {
    return Response.json({ error: "Name or email is too long" }, { status: 400 });
  }

  if (!validateEmail(normalizedEmail)) {
    return Response.json({ error: "Invalid email format" }, { status: 400 });
  }

  if (!password || typeof password !== "string") {
    return Response.json({ error: "Password is required" }, { status: 400 });
  }

  if (!validateAdminPassword(password)) {
    return Response.json(
      { error: "Invalid password: use 8-128 printable ASCII characters without spaces" },
      { status: 400 }
    );
  }

  const apiKey = generateApiKey();
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await db.insert(users).values({
      name: normalizedName,
      email: normalizedEmail,
      apiKey,
      passwordHash,
      isActive: false,
      isAdmin: false,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.toLowerCase().includes("unique")) {
      return Response.json(
        { error: "Email already registered, please wait for approval" },
        { status: 409 }
      );
    }
    throw err;
  }

  const adminName = process.env.ADMIN_NAME || "admin";

  return Response.json(
    {
      message: "Registration submitted and pending admin approval",
      adminName,
      data: {
        email: normalizedEmail,
        status: "pending_approval",
      },
    },
    { status: 201 }
  );
}
