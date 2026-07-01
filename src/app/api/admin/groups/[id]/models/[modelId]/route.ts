import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { groupModels, groupModelQuotas, groups, models } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
} from "@/app/api/admin/middleware";
import { recordAudit } from "@/lib/audit/recorder";

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

  const [group] = await db
    .select({ name: groups.name })
    .from(groups)
    .where(eq(groups.id, id))
    .limit(1);
  const [model] = await db
    .select({ alias: models.alias })
    .from(models)
    .where(eq(models.id, modelId))
    .limit(1);

  recordAudit({
    adminId: admin.userId,
    adminEmail: admin.email,
    action: "group.revoke_model",
    resourceType: "group",
    resourceId: id,
    resourceLabel: group?.name ?? null,
    changes: { before: { model: model?.alias ?? modelId } },
    metadata: { modelId, modelAlias: model?.alias ?? null },
    req,
  });

  return Response.json({ success: true });
}
