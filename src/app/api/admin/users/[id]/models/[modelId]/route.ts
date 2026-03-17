import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { userModels, userModelQuotas } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
} from "@/app/api/admin/middleware";

type Params = { params: Promise<{ id: string; modelId: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id, modelId } = await params;

  await db
    .delete(userModels)
    .where(
      and(eq(userModels.userId, id), eq(userModels.modelId, modelId))
    );

  // Also delete quota
  await db
    .delete(userModelQuotas)
    .where(
      and(eq(userModelQuotas.userId, id), eq(userModelQuotas.modelId, modelId))
    );

  return Response.json({ success: true });
}
