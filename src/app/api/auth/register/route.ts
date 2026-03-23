import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { generateApiKey } from "@/lib/utils/api-key";
import { validateEmail } from "@/lib/utils/validators";

export async function POST(req: NextRequest) {
  const { name, email } = await req.json();

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

  const apiKey = generateApiKey();

  try {
    await db.insert(users).values({
      name: normalizedName,
      email: normalizedEmail,
      apiKey,
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

  return Response.json(
    {
      message: "Registration submitted and pending admin approval",
      data: {
        email: normalizedEmail,
        status: "pending_approval",
      },
    },
    { status: 201 }
  );
}
