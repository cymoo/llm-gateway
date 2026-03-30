import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, userModels } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAdminUser, unauthorizedResponse } from "@/app/api/admin/middleware";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;

  const result = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: userModels.createdAt,
    })
    .from(userModels)
    .innerJoin(users, eq(userModels.userId, users.id))
    .where(eq(userModels.modelId, id))
    .orderBy(userModels.createdAt);

  return Response.json(result);
}
