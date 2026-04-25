import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { groups, users } from "@/lib/db/schema";
import { eq, count, desc, asc } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
  badRequestResponse,
} from "@/app/api/admin/middleware";

export async function GET(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const rows = await db
    .select({
      id: groups.id,
      name: groups.name,
      remark: groups.remark,
      isDefault: groups.isDefault,
      createdAt: groups.createdAt,
      updatedAt: groups.updatedAt,
      memberCount: count(users.id),
    })
    .from(groups)
    .leftJoin(users, eq(users.groupId, groups.id))
    .groupBy(groups.id)
    .orderBy(desc(groups.isDefault), asc(groups.createdAt));

  return Response.json(rows);
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { name, remark } = await req.json();

  if (!name || typeof name !== "string" || !name.trim()) {
    return badRequestResponse("Group name is required");
  }

  try {
    const [group] = await db
      .insert(groups)
      .values({ name: name.trim(), remark, isDefault: false })
      .returning();

    return Response.json(group, { status: 201 });
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
