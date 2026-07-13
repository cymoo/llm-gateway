import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, groups, models, userModels, groupModels } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { makeProxyError } from "@/lib/proxy/errors";
import { getBackendContextWindows } from "@/lib/proxy/context-window";

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

export async function GET(req: NextRequest) {
  const user = await authenticate(req);
  if (!user) {
    return makeProxyError(
      "Invalid API key",
      "authentication_error",
      "invalid_api_key",
      401
    );
  }

  // Determine group membership
  const groupRows = user.groupId
    ? await db.select().from(groups).where(eq(groups.id, user.groupId)).limit(1)
    : [];
  const group = groupRows[0];
  const isDefaultGroup = !group || group.isDefault;

  // Accessible models are the union of the group's models (for a non-default
  // group) and the user's own authorized models, matching proxy authorization.
  type ModelSelectRow = { model: typeof models.$inferSelect };

  const [groupModelRows, userModelRows] = await Promise.all([
    !isDefaultGroup && group
      ? db
          .select({ model: models })
          .from(groupModels)
          .innerJoin(models, eq(groupModels.modelId, models.id))
          .where(and(eq(groupModels.groupId, group.id), eq(models.isActive, true)))
      : Promise.resolve<ModelSelectRow[]>([]),
    db
      .select({ model: models })
      .from(userModels)
      .innerJoin(models, eq(userModels.modelId, models.id))
      .where(and(eq(userModels.userId, user.id), eq(models.isActive, true))),
  ]);

  const modelMap = new Map<string, typeof models.$inferSelect>();
  for (const { model } of groupModelRows) modelMap.set(model.id, model);
  for (const { model } of userModelRows) {
    if (!modelMap.has(model.id)) modelMap.set(model.id, model);
  }
  const authorizedModels = Array.from(modelMap.values());

  // Probe each distinct backend's /models once (cached) to discover context
  // windows, then attach them by backend model id. Best-effort: a model whose
  // backend is unreachable or advertises no window simply omits the field.
  const backendKeys = new Map<string, string | null>();
  for (const model of authorizedModels) {
    if (model.backendUrl && !backendKeys.has(model.backendUrl)) {
      backendKeys.set(model.backendUrl, model.backendApiKey ?? null);
    }
  }
  const windowMaps = new Map<string, Map<string, number>>();
  await Promise.all(
    Array.from(backendKeys, async ([url, key]) => {
      windowMaps.set(url, await getBackendContextWindows(url, key));
    })
  );

  const data = authorizedModels.map((model) => {
    const maxModelLen = windowMaps
      .get(model.backendUrl)
      ?.get(model.backendModel);
    return {
      id: model.alias,
      object: "model",
      created: Math.floor(new Date(model.createdAt!).getTime() / 1000),
      owned_by: "llm-gateway",
      type: model.type ?? "chat",
      ...(maxModelLen !== undefined ? { max_model_len: maxModelLen } : {}),
    };
  });

  return Response.json({ object: "list", data });
}
