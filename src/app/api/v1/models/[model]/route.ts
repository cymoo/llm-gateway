import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, groups, models, userModels, groupModels } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { makeProxyError } from "@/lib/proxy/errors";
import { getBackendContextWindows } from "@/lib/proxy/context-window";
import { getActiveBackends } from "@/lib/proxy/backends";

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

  // Determine group membership and check authorization
  const groupRows = user.groupId
    ? await db.select().from(groups).where(eq(groups.id, user.groupId)).limit(1)
    : [];
  const group = groupRows[0];
  const isDefaultGroup = !group || group.isDefault;

  // Authorized if the model is in the user's group (non-default group) or in
  // the user's own model list, matching proxy authorization.
  let authorized = false;
  if (!isDefaultGroup && group) {
    const groupAuthRows = await db
      .select()
      .from(groupModels)
      .where(and(eq(groupModels.groupId, group.id), eq(groupModels.modelId, model.id)))
      .limit(1);
    authorized = groupAuthRows.length > 0;
  }
  if (!authorized) {
    const userAuthRows = await db
      .select()
      .from(userModels)
      .where(and(eq(userModels.userId, user.id), eq(userModels.modelId, model.id)))
      .limit(1);
    authorized = userAuthRows.length > 0;
  }

  if (!authorized) {
    return makeProxyError(
      `You are not authorized to use model '${modelAlias}'`,
      "permission_error",
      "model_not_allowed",
      403
    );
  }

  // Best-effort context window from each active backend's /models (cached);
  // with several backends the safe served window is the minimum advertised.
  // Omitted when no backend is reachable or advertises a window.
  const backends = await getActiveBackends(model.id);
  let maxModelLen: number | undefined;
  await Promise.all(
    backends.map(async (backend) => {
      const windows = await getBackendContextWindows(
        backend.backendUrl,
        backend.backendApiKey
      );
      const len = windows.get(backend.backendModel);
      if (len !== undefined && (maxModelLen === undefined || len < maxModelLen)) {
        maxModelLen = len;
      }
    })
  );

  return Response.json({
    id: model.alias,
    object: "model",
    created: Math.floor(new Date(model.createdAt!).getTime() / 1000),
    owned_by: "llm-gateway",
    type: model.type ?? "chat",
    ...(maxModelLen !== undefined ? { max_model_len: maxModelLen } : {}),
  });
}
