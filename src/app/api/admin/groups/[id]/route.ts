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
import { recordAudit, diff } from "@/lib/audit/recorder";

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

    recordAudit({
      adminId: admin.userId,
      adminEmail: admin.email,
      action: "group.update",
      resourceType: "group",
      resourceId: updated.id,
      resourceLabel: updated.name,
      changes: diff(group, updated),
      req,
    });

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

  const defaultGroup = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.isDefault, true))
    .limit(1);
  const defaultGroupId = defaultGroup[0]?.id;

  if (defaultGroupId) {
    await db.update(users).set({ groupId: defaultGroupId }).where(eq(users.groupId, id));
  }

  await db.delete(groups).where(eq(groups.id, id));

  recordAudit({
    adminId: admin.userId,
    adminEmail: admin.email,
    action: "group.delete",
    resourceType: "group",
    resourceId: group.id,
    resourceLabel: group.name,
    changes: diff(group, null),
    metadata: { reassignedMembersToGroupId: defaultGroupId ?? null },
    req,
  });

  return new Response(null, { status: 204 });
}
