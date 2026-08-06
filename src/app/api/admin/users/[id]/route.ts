import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, groups } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  getAdminUser,
  unauthorizedResponse,
  notFoundResponse,
  badRequestResponse,
} from "@/app/api/admin/middleware";
import { validateAdminPassword } from "@/lib/utils/validators";
import { recordAudit, diff } from "@/lib/audit/recorder";

type Params = { params: Promise<{ id: string }> };

/** Postgres foreign_key_violation. pg surfaces it as `code` on the error. */
function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23503"
  );
}

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
  const { name, email, remark, isActive, isAdmin, password, groupId } = await req.json();
  const userRows = await db.select().from(users).where(eq(users.id, id)).limit(1);

  if (userRows.length === 0) return notFoundResponse("User not found");
  const existingUser = userRows[0];
  const willBeAdmin = isAdmin ?? existingUser.isAdmin;
  const hasPassword = typeof password === "string" && password.length > 0;

  if (willBeAdmin && !existingUser.passwordHash && !hasPassword) {
    return Response.json(
      { error: "Password is required when enabling admin access" },
      { status: 400 }
    );
  }

  if (hasPassword && !validateAdminPassword(password)) {
    return Response.json(
      {
        error:
          "Invalid password: use 8-128 printable ASCII characters without spaces",
      },
      { status: 400 }
    );
  }

  const updates: Partial<typeof users.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email;
  if (remark !== undefined) updates.remark = remark;
  if (isActive !== undefined) updates.isActive = isActive;
  if (isAdmin !== undefined) updates.isAdmin = isAdmin;
  if (hasPassword) updates.passwordHash = await bcrypt.hash(password, 10);
  if (groupId !== undefined) {
    // Validate groupId exists
    if (groupId !== null) {
      const groupRows = await db
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);
      if (groupRows.length === 0) return badRequestResponse("Group not found");
    }
    updates.groupId = groupId;
  }
  updates.updatedAt = new Date();

  try {
    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();

    if (!updated) return notFoundResponse("User not found");

    recordAudit({
      adminId: admin.userId,
      adminEmail: admin.email,
      action: "user.update",
      resourceType: "user",
      resourceId: updated.id,
      resourceLabel: updated.email,
      changes: diff(existingUser, updated),
      req,
    });

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

  let deleted: typeof users.$inferSelect | undefined;
  try {
    [deleted] = await db.delete(users).where(eq(users.id, id)).returning();
  } catch (err: unknown) {
    // 23503: a table still referencing this user blocks the delete. Surface a
    // readable message instead of an opaque 500.
    if (isForeignKeyViolation(err)) {
      return Response.json(
        {
          error:
            "User still has linked records and cannot be deleted. Deactivate the account instead.",
        },
        { status: 409 }
      );
    }
    throw err;
  }

  if (!deleted) return notFoundResponse("User not found");

  recordAudit({
    adminId: admin.userId,
    adminEmail: admin.email,
    action: "user.delete",
    resourceType: "user",
    resourceId: deleted.id,
    resourceLabel: deleted.email,
    changes: diff(deleted, null),
    req,
  });

  return Response.json({ success: true });
}
