import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, groups } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
  notFoundResponse,
} from "@/app/api/admin/middleware";

type Params = { params: Promise<{ id: string; userId: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { userId } = await params;

  const user = await db.select({ id: users.id, groupId: users.groupId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user[0]) return notFoundResponse("User not found");

  const defaultGroup = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.isDefault, true))
    .limit(1);

  const defaultGroupId = defaultGroup[0]?.id ?? null;
  await db.update(users).set({ groupId: defaultGroupId }).where(eq(users.id, userId));

  return new Response(null, { status: 204 });
}
