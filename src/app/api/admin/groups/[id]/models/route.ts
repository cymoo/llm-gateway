import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { groupModels, groupModelQuotas, models, groups } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
  notFoundResponse,
} from "@/app/api/admin/middleware";
import { recordAudit } from "@/lib/audit/recorder";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;

  const rows = await db
    .select({
      model: models,
      quota: groupModelQuotas,
      createdAt: groupModels.createdAt,
    })
    .from(groupModels)
    .innerJoin(models, eq(groupModels.modelId, models.id))
    .leftJoin(
      groupModelQuotas,
      and(
        eq(groupModelQuotas.groupId, id),
        eq(groupModelQuotas.modelId, models.id)
      )
    )
    .where(eq(groupModels.groupId, id));

  return Response.json(rows);
}

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;

  // Verify group exists
  const groupRows = await db
    .select()
    .from(groups)
    .where(eq(groups.id, id))
    .limit(1);
  if (groupRows.length === 0) return notFoundResponse("Group not found");

  const { modelId } = await req.json();
  if (!modelId) {
    return Response.json({ error: "modelId is required" }, { status: 400 });
  }

  // Get model to inherit default quotas
  const modelRows = await db
    .select()
    .from(models)
    .where(eq(models.id, modelId))
    .limit(1);
  if (modelRows.length === 0) return notFoundResponse("Model not found");
  const model = modelRows[0];

  // Add authorization
  try {
    await db.insert(groupModels).values({ groupId: id, modelId });
  } catch {
    return Response.json(
      { error: "Model already authorized for this group" },
      { status: 409 }
    );
  }

  // Auto-inherit default quota template from model
  const hasDefaults =
    model.defaultMaxTokensPerDay !== null ||
    model.defaultMaxRequestsPerDay !== null ||
    model.defaultMaxRequestsPerMin !== null ||
    model.defaultAllowedTimeStart !== null ||
    model.defaultAllowedTimeEnd !== null;

  if (hasDefaults) {
    await db
      .insert(groupModelQuotas)
      .values({
        groupId: id,
        modelId,
        maxTokensPerDay: model.defaultMaxTokensPerDay,
        maxRequestsPerDay: model.defaultMaxRequestsPerDay,
        maxRequestsPerMin: model.defaultMaxRequestsPerMin,
        allowedTimeStart: model.defaultAllowedTimeStart,
        allowedTimeEnd: model.defaultAllowedTimeEnd,
      })
      .onConflictDoNothing();
  }

  recordAudit({
    adminId: admin.userId,
    adminEmail: admin.email,
    action: "group.grant_model",
    resourceType: "group",
    resourceId: id,
    resourceLabel: groupRows[0].name,
    changes: { after: { model: model.alias } },
    metadata: { modelId, modelAlias: model.alias },
    req,
  });

  return Response.json({ success: true }, { status: 201 });
}
