import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, groups } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
  notFoundResponse,
  badRequestResponse,
} from "@/app/api/admin/middleware";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;

  const members = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.groupId, id));

  return Response.json(members);
}

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;

  const group = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, id)).limit(1);
  if (!group[0]) return notFoundResponse("Group not found");

  const body = await req.json().catch(() => null);
  if (!body?.userId) return badRequestResponse("userId is required");

  const user = await db.select({ id: users.id }).from(users).where(eq(users.id, body.userId)).limit(1);
  if (!user[0]) return notFoundResponse("User not found");

  await db.update(users).set({ groupId: id }).where(eq(users.id, body.userId));

  return Response.json({ ok: true });
}
