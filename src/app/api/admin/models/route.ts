import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { models, userModels } from "@/lib/db/schema";
import { count, eq } from "drizzle-orm";
import { getAdminUser, unauthorizedResponse } from "@/app/api/admin/middleware";
import { validateModelAlias, validateUrl } from "@/lib/utils/validators";

export async function GET(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const modelList = await db.select().from(models).orderBy(models.createdAt);

  // Get user counts
  const userCounts = await db
    .select({ modelId: userModels.modelId, count: count() })
    .from(userModels)
    .groupBy(userModels.modelId);

  const userCountMap = new Map(userCounts.map((r) => [r.modelId, r.count]));

  const result = modelList.map((m) => ({
    ...m,
    userCount: userCountMap.get(m.id) || 0,
  }));

  return Response.json(result);
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const body = await req.json();
  const { alias, backendUrl, backendModel, backendApiKey, ...rest } = body;

  if (!alias || !backendUrl || !backendModel) {
    return Response.json(
      { error: "alias, backendUrl, and backendModel are required" },
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

  if (!validateUrl(backendUrl)) {
    return Response.json({ error: "Invalid backendUrl" }, { status: 400 });
  }

  try {
    const [model] = await db
      .insert(models)
      .values({
        alias,
        backendUrl,
        backendModel,
        backendApiKey: backendApiKey || null,
        isActive: rest.isActive ?? true,
        defaultMaxTokensPerDay: rest.defaultMaxTokensPerDay ?? null,
        defaultMaxRequestsPerDay: rest.defaultMaxRequestsPerDay ?? null,
        defaultMaxRequestsPerMin: rest.defaultMaxRequestsPerMin ?? null,
        defaultAllowedTimeStart: rest.defaultAllowedTimeStart ?? null,
        defaultAllowedTimeEnd: rest.defaultAllowedTimeEnd ?? null,
      })
      .returning();

    return Response.json(model, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return Response.json({ error: "Model alias already exists" }, { status: 409 });
    }
    throw err;
  }
}
