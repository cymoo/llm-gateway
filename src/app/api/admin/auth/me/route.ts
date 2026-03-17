import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAdminUser, unauthorizedResponse } from "@/app/api/admin/middleware";

export async function GET(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, admin.userId))
    .limit(1);

  if (userRows.length === 0) return unauthorizedResponse();

  const user = userRows[0];
  return Response.json({
    id: user.id,
    name: user.name,
    email: user.email,
  });
}
