import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  users,
  groups,
  models,
  modelBackends,
  userModels,
  groupModels,
} from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
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

  // Fetch each model's active backends, then probe each distinct backend's
  // /models once (cached) to discover context windows. With several backends
  // per model, the safe served window is the minimum of what they advertise.
  // Best-effort: backends that are unreachable or advertise no window are
  // ignored; a model with no advertised window omits the field.
  const backendRows =
    authorizedModels.length > 0
      ? await db
          .select()
          .from(modelBackends)
          .where(
            and(
              inArray(
                modelBackends.modelId,
                authorizedModels.map((m) => m.id)
              ),
              eq(modelBackends.isActive, true)
            )
          )
      : [];

  const backendsByModel = new Map<string, typeof backendRows>();
  const backendKeys = new Map<string, string | null>();
  for (const backend of backendRows) {
    const list = backendsByModel.get(backend.modelId);
    if (list) list.push(backend);
    else backendsByModel.set(backend.modelId, [backend]);
    if (!backendKeys.has(backend.backendUrl)) {
      backendKeys.set(backend.backendUrl, backend.backendApiKey ?? null);
    }
  }

  const windowMaps = new Map<string, Map<string, number>>();
  await Promise.all(
    Array.from(backendKeys, async ([url, key]) => {
      windowMaps.set(url, await getBackendContextWindows(url, key));
    })
  );

  const data = authorizedModels.map((model) => {
    let maxModelLen: number | undefined;
    for (const backend of backendsByModel.get(model.id) ?? []) {
      const len = windowMaps
        .get(backend.backendUrl)
        ?.get(backend.backendModel);
      if (len !== undefined && (maxModelLen === undefined || len < maxModelLen)) {
        maxModelLen = len;
      }
    }
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
