import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, models, userModels } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { makeProxyError } from "@/lib/proxy/errors";

async function authenticate(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const apiKey = authHeader.slice(7).trim();

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.apiKey, apiKey))
    .limit(1);

  if (rows.length === 0 || !rows[0].isActive) return null;
  return rows[0];
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ model: string }> }
) {
  const user = await authenticate(req);
  if (!user) {
    return makeProxyError(
      "Invalid API key",
      "authentication_error",
      "invalid_api_key",
      401
    );
  }

  const { model: modelAlias } = await params;

  const modelRows = await db
    .select()
    .from(models)
    .where(and(eq(models.alias, modelAlias), eq(models.isActive, true)))
    .limit(1);

  if (modelRows.length === 0) {
    return makeProxyError(
      `Model '${modelAlias}' not found`,
      "not_found_error",
      "model_not_found",
      404
    );
  }

  const model = modelRows[0];

  // Check authorization
  const authRows = await db
    .select()
    .from(userModels)
    .where(
      and(eq(userModels.userId, user.id), eq(userModels.modelId, model.id))
    )
    .limit(1);

  if (authRows.length === 0) {
    return makeProxyError(
      `You are not authorized to use model '${modelAlias}'`,
      "permission_error",
      "model_not_allowed",
      403
    );
  }

  return Response.json({
    id: model.alias,
    object: "model",
    created: Math.floor(new Date(model.createdAt!).getTime() / 1000),
    owned_by: "llm-gateway",
  });
}
