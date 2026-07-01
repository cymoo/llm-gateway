import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { userModels, userModelQuotas, users, models } from "@/lib/db/schema";
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

  const [targetUser] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  const [model] = await db
    .select({ alias: models.alias })
    .from(models)
    .where(eq(models.id, modelId))
    .limit(1);

  recordAudit({
    adminId: admin.userId,
    adminEmail: admin.email,
    action: "user.revoke_model",
    resourceType: "user",
    resourceId: id,
    resourceLabel: targetUser?.email ?? null,
    changes: { before: { model: model?.alias ?? modelId } },
    metadata: { modelId, modelAlias: model?.alias ?? null },
    req,
  });

  return Response.json({ success: true });
}
