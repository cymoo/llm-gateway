import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
  notFoundResponse,
} from "@/app/api/admin/middleware";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);

  if (rows.length === 0) return notFoundResponse("User not found");
  return Response.json(rows[0]);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const { name, email, isActive } = await req.json();

  const updates: Partial<typeof users.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email;
  if (isActive !== undefined) updates.isActive = isActive;
  updates.updatedAt = new Date();

  try {
    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();

    if (!updated) return notFoundResponse("User not found");
    return Response.json(updated);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return Response.json({ error: "Email already exists" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;

  // Prevent deleting self
  if (id === admin.userId) {
    return Response.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const [deleted] = await db
    .delete(users)
    .where(eq(users.id, id))
    .returning();

  if (!deleted) return notFoundResponse("User not found");
  return Response.json({ success: true });
}
