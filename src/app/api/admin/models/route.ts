import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { models, modelBackends, userModels } from "@/lib/db/schema";
import { asc, count } from "drizzle-orm";
import { getAdminUser, unauthorizedResponse } from "@/app/api/admin/middleware";
import {
  MODEL_TYPES,
  validateModelAlias,
  validateModelType,
} from "@/lib/utils/validators";
import { recordAudit, diff } from "@/lib/audit/recorder";
import { parseBackendsArray } from "./backends-input";

export async function GET(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const [modelList, backendList, userCounts] = await Promise.all([
    db.select().from(models).orderBy(models.createdAt),
    db
      .select()
      .from(modelBackends)
      .orderBy(asc(modelBackends.createdAt), asc(modelBackends.id)),
    db
      .select({ modelId: userModels.modelId, count: count() })
      .from(userModels)
      .groupBy(userModels.modelId),
  ]);

  const backendMap = new Map<string, typeof backendList>();
  for (const backend of backendList) {
    const list = backendMap.get(backend.modelId);
    if (list) list.push(backend);
    else backendMap.set(backend.modelId, [backend]);
  }
  const userCountMap = new Map(userCounts.map((r) => [r.modelId, r.count]));

  const result = modelList.map((m) => ({
    ...m,
    backends: backendMap.get(m.id) ?? [],
    userCount: userCountMap.get(m.id) || 0,
  }));

  return Response.json(result);
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const body = await req.json();
  const { alias, type, ...rest } = body;

  // Legacy single-backend shorthand: flat backendUrl/backendModel/backendApiKey.
  const backendsRaw =
    body.backends !== undefined
      ? body.backends
      : body.backendUrl !== undefined || body.backendModel !== undefined
        ? [
            {
              backendUrl: body.backendUrl,
              backendModel: body.backendModel,
              backendApiKey: body.backendApiKey,
            },
          ]
        : undefined;

  if (!alias || backendsRaw === undefined) {
    return Response.json(
      { error: "alias and backends are required" },
      { status: 400 }
    );
  }

  if (!validateModelAlias(alias)) {
    return Response.json(
      {
        error:
          "Invalid alias: must match ^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$ and be 1-100 chars",
      },
      { status: 400 }
    );
  }

  const parsed = parseBackendsArray(backendsRaw);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  if (type !== undefined && !validateModelType(type)) {
    return Response.json(
      {
        error: `Invalid type: must be one of ${MODEL_TYPES.map(
          (t) => `'${t}'`
        ).join(", ")}`,
      },
      { status: 400 }
    );
  }

  try {
    const created = await db.transaction(async (tx) => {
      const [model] = await tx
        .insert(models)
        .values({
          alias,
          type: type ?? "chat",
          remark: rest.remark,
          isActive: rest.isActive ?? true,
          defaultMaxTokensPerDay: rest.defaultMaxTokensPerDay ?? null,
          defaultMaxRequestsPerDay: rest.defaultMaxRequestsPerDay ?? null,
          defaultMaxRequestsPerMin: rest.defaultMaxRequestsPerMin ?? null,
          defaultAllowedTimeStart: rest.defaultAllowedTimeStart ?? null,
          defaultAllowedTimeEnd: rest.defaultAllowedTimeEnd ?? null,
        })
        .returning();

      const backends = await tx
        .insert(modelBackends)
        .values(
          parsed.backends.map((b) => ({
            modelId: model.id,
            backendUrl: b.backendUrl,
            backendModel: b.backendModel,
            backendApiKey: b.backendApiKey,
            isActive: b.isActive,
          }))
        )
        .returning();

      return { ...model, backends };
    });

    recordAudit({
      adminId: admin.userId,
      adminEmail: admin.email,
      action: "model.create",
      resourceType: "model",
      resourceId: created.id,
      resourceLabel: created.alias,
      changes: diff(null, created),
      req,
    });

    return Response.json(created, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return Response.json(
        { error: "Model alias already exists" },
        { status: 409 }
      );
    }
    throw err;
  }
}
