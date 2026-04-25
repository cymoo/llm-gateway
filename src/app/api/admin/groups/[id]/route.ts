import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { groups, users } from "@/lib/db/schema";
import { eq, count } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
  notFoundResponse,
  badRequestResponse,
} from "@/app/api/admin/middleware";

type Params = { params: Promise<{ id: string }> };

async function resolveGroup(id: string) {
  const rows = await db
    .select()
    .from(groups)
    .where(eq(groups.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const group = await resolveGroup(id);
  if (!group) return notFoundResponse("Group not found");

  const [{ memberCount }] = await db
    .select({ memberCount: count(users.id) })
    .from(users)
    .where(eq(users.groupId, id));

  return Response.json({ ...group, memberCount });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const group = await resolveGroup(id);
  if (!group) return notFoundResponse("Group not found");

  const { name, remark } = await req.json();

  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return badRequestResponse("Group name must be a non-empty string");
  }

  try {
    const [updated] = await db
      .update(groups)
      .set({
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(remark !== undefined ? { remark } : {}),
        updatedAt: new Date(),
      })
      .where(eq(groups.id, id))
      .returning();

    return Response.json(updated);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return Response.json(
        { error: "A group with this name already exists" },
        { status: 409 }
      );
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const group = await resolveGroup(id);
  if (!group) return notFoundResponse("Group not found");

  if (group.isDefault) {
    return Response.json(
      { error: "The default group cannot be deleted" },
      { status: 409 }
    );
  }

  const [{ memberCount }] = await db
    .select({ memberCount: count(users.id) })
    .from(users)
    .where(eq(users.groupId, id));

  if (memberCount > 0) {
    return Response.json(
      { error: "Cannot delete a group that has members. Reassign users first." },
      { status: 409 }
    );
  }

  await db.delete(groups).where(eq(groups.id, id));

  return new Response(null, { status: 204 });
}
