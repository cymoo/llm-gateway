import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { userModels, models, userModelQuotas } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
  notFoundResponse,
} from "@/app/api/admin/middleware";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;

  const rows = await db
    .select({
      model: models,
      quota: userModelQuotas,
      createdAt: userModels.createdAt,
    })
    .from(userModels)
    .innerJoin(models, eq(userModels.modelId, models.id))
    .leftJoin(
      userModelQuotas,
      and(
        eq(userModelQuotas.userId, id),
        eq(userModelQuotas.modelId, models.id)
      )
    )
    .where(eq(userModels.userId, id));

  return Response.json(rows);
}

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
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
    await db.insert(userModels).values({ userId: id, modelId });
  } catch {
    return Response.json({ error: "Model already authorized" }, { status: 409 });
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
      .insert(userModelQuotas)
      .values({
        userId: id,
        modelId,
        maxTokensPerDay: model.defaultMaxTokensPerDay,
        maxRequestsPerDay: model.defaultMaxRequestsPerDay,
        maxRequestsPerMin: model.defaultMaxRequestsPerMin,
        allowedTimeStart: model.defaultAllowedTimeStart,
        allowedTimeEnd: model.defaultAllowedTimeEnd,
      })
      .onConflictDoNothing();
  }

  return Response.json({ success: true }, { status: 201 });
}
