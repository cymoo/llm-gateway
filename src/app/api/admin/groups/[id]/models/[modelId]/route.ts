import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { groupModels, groupModelQuotas } from "@/lib/db/schema";
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
    .delete(groupModels)
    .where(
      and(eq(groupModels.groupId, id), eq(groupModels.modelId, modelId))
    );

  // Cascade deletes quota (FK has onDelete: cascade), but also explicit delete
  await db
    .delete(groupModelQuotas)
    .where(
      and(
        eq(groupModelQuotas.groupId, id),
        eq(groupModelQuotas.modelId, modelId)
      )
    );

  return Response.json({ success: true });
}
