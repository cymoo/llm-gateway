import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { userModelQuotas, users, models } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
} from "@/app/api/admin/middleware";
import { recordAudit, diff } from "@/lib/audit/recorder";

type Params = { params: Promise<{ id: string; modelId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id, modelId } = await params;

  const body = await req.json();

  const [before] = await db
    .select()
    .from(userModelQuotas)
    .where(
      and(eq(userModelQuotas.userId, id), eq(userModelQuotas.modelId, modelId))
    )
    .limit(1);

  const quota = {
    userId: id,
    modelId,
    maxTokensPerDay: body.maxTokensPerDay ?? null,
    maxRequestsPerDay: body.maxRequestsPerDay ?? null,
    maxRequestsPerMin: body.maxRequestsPerMin ?? null,
    allowedTimeStart: body.allowedTimeStart ?? null,
    allowedTimeEnd: body.allowedTimeEnd ?? null,
    updatedAt: new Date(),
  };

  const [result] = await db
    .insert(userModelQuotas)
    .values(quota)
    .onConflictDoUpdate({
      target: [userModelQuotas.userId, userModelQuotas.modelId],
      set: {
        maxTokensPerDay: quota.maxTokensPerDay,
        maxRequestsPerDay: quota.maxRequestsPerDay,
        maxRequestsPerMin: quota.maxRequestsPerMin,
        allowedTimeStart: quota.allowedTimeStart,
        allowedTimeEnd: quota.allowedTimeEnd,
        updatedAt: quota.updatedAt,
      },
    })
    .returning();

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
    action: "user.update_quota",
    resourceType: "user",
    resourceId: id,
    resourceLabel: targetUser?.email ?? null,
    changes: diff(before ?? null, result),
    metadata: { modelId, modelAlias: model?.alias ?? null },
    req,
  });

  return Response.json(result);
}
