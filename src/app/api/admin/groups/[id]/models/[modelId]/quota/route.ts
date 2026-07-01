import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { groupModelQuotas, groups, models } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
} from "@/app/api/admin/middleware";
import { recordAudit, diff } from "@/lib/audit/recorder";

type Params = { params: Promise<{ id: string; modelId: string }> };

async function quotaLabels(groupId: string, modelId: string) {
  const [group] = await db
    .select({ name: groups.name })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  const [model] = await db
    .select({ alias: models.alias })
    .from(models)
    .where(eq(models.id, modelId))
    .limit(1);
  return { groupName: group?.name ?? null, modelAlias: model?.alias ?? null };
}

export async function PUT(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id, modelId } = await params;
  const body = await req.json();

  const [before] = await db
    .select()
    .from(groupModelQuotas)
    .where(
      and(eq(groupModelQuotas.groupId, id), eq(groupModelQuotas.modelId, modelId))
    )
    .limit(1);

  const quota = {
    groupId: id,
    modelId,
    maxTokensPerDay: body.maxTokensPerDay ?? null,
    maxRequestsPerDay: body.maxRequestsPerDay ?? null,
    maxRequestsPerMin: body.maxRequestsPerMin ?? null,
    allowedTimeStart: body.allowedTimeStart ?? null,
    allowedTimeEnd: body.allowedTimeEnd ?? null,
    updatedAt: new Date(),
  };

  const [result] = await db
    .insert(groupModelQuotas)
    .values(quota)
    .onConflictDoUpdate({
      target: [groupModelQuotas.groupId, groupModelQuotas.modelId],
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

  const { groupName, modelAlias } = await quotaLabels(id, modelId);
  recordAudit({
    adminId: admin.userId,
    adminEmail: admin.email,
    action: "group.update_quota",
    resourceType: "group",
    resourceId: id,
    resourceLabel: groupName,
    changes: diff(before ?? null, result),
    metadata: { modelId, modelAlias },
    req,
  });

  return Response.json(result);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id, modelId } = await params;

  const [before] = await db
    .select()
    .from(groupModelQuotas)
    .where(
      and(eq(groupModelQuotas.groupId, id), eq(groupModelQuotas.modelId, modelId))
    )
    .limit(1);

  await db
    .delete(groupModelQuotas)
    .where(
      and(
        eq(groupModelQuotas.groupId, id),
        eq(groupModelQuotas.modelId, modelId)
      )
    );

  const { groupName, modelAlias } = await quotaLabels(id, modelId);
  recordAudit({
    adminId: admin.userId,
    adminEmail: admin.email,
    action: "group.reset_quota",
    resourceType: "group",
    resourceId: id,
    resourceLabel: groupName,
    changes: diff(before ?? null, null),
    metadata: { modelId, modelAlias },
    req,
  });

  return Response.json({ success: true });
}
