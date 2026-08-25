import { db } from "@/lib/db";
import {
  users,
  groups,
  models,
  modelBackends,
  userModels,
  groupModels,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getBackendContextWindows } from "@/lib/proxy/context-window";

export interface AuthorizedModelCatalogEntry {
  id: string;
  alias: string;
  type: string;
  createdAt: Date;
  maxModelLen?: number;
}

/**
 * Resolves an API key to the models the user may access and enriches them with
 * the safe context window shared by every active backend. Both OpenAI- and
 * Anthropic-compatible model-list endpoints use this catalog so permissions
 * and backend probing cannot drift between protocols.
 */
export async function getAuthorizedModelCatalog(
  apiKey: string
): Promise<AuthorizedModelCatalogEntry[] | null> {
  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.apiKey, apiKey))
    .limit(1);

  if (userRows.length === 0 || !userRows[0].isActive) return null;
  const user = userRows[0];

  const groupRows = user.groupId
    ? await db.select().from(groups).where(eq(groups.id, user.groupId)).limit(1)
    : [];
  const group = groupRows[0];
  const isDefaultGroup = !group || group.isDefault;

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

  const backendRows =
    authorizedModels.length > 0
      ? await db
          .select()
          .from(modelBackends)
          .where(
            and(
              inArray(
                modelBackends.modelId,
                authorizedModels.map((model) => model.id)
              ),
              eq(modelBackends.isActive, true)
            )
          )
      : [];

  const probeKey = (backend: {
    backendUrl: string;
    backendApiKey: string | null;
  }) => `${backend.backendUrl} ${backend.backendApiKey ?? ""}`;

  const backendsByModel = new Map<string, typeof backendRows>();
  const probes = new Map<string, { url: string; apiKey: string | null }>();
  for (const backend of backendRows) {
    const list = backendsByModel.get(backend.modelId);
    if (list) list.push(backend);
    else backendsByModel.set(backend.modelId, [backend]);
    if (!probes.has(probeKey(backend))) {
      probes.set(probeKey(backend), {
        url: backend.backendUrl,
        apiKey: backend.backendApiKey ?? null,
      });
    }
  }

  const windowMaps = new Map<string, Map<string, number>>();
  await Promise.all(
    Array.from(probes, async ([key, { url, apiKey: backendApiKey }]) => {
      windowMaps.set(
        key,
        await getBackendContextWindows(url, backendApiKey)
      );
    })
  );

  return authorizedModels.map((model) => {
    let maxModelLen: number | undefined;
    for (const backend of backendsByModel.get(model.id) ?? []) {
      const len = windowMaps.get(probeKey(backend))?.get(backend.backendModel);
      if (len !== undefined && (maxModelLen === undefined || len < maxModelLen)) {
        maxModelLen = len;
      }
    }
    return {
      id: model.id,
      alias: model.alias,
      type: model.type ?? "chat",
      createdAt: model.createdAt ?? new Date(0),
      ...(maxModelLen !== undefined ? { maxModelLen } : {}),
    };
  });
}
