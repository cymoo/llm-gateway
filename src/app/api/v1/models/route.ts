import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, groups, models, userModels, groupModels } from "@/lib/db/schema";
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

  let authorizedModels: Array<{ model: typeof models.$inferSelect }>;

  if (isDefaultGroup) {
    authorizedModels = await db
      .select({ model: models })
      .from(userModels)
      .innerJoin(models, eq(userModels.modelId, models.id))
      .where(and(eq(userModels.userId, user.id), eq(models.isActive, true)));
  } else {
    authorizedModels = await db
      .select({ model: models })
      .from(groupModels)
      .innerJoin(models, eq(groupModels.modelId, models.id))
      .where(and(eq(groupModels.groupId, group.id), eq(models.isActive, true)));
  }

  const data = authorizedModels.map(({ model }) => ({
    id: model.alias,
    object: "model",
    created: Math.floor(new Date(model.createdAt!).getTime() / 1000),
    owned_by: "llm-gateway",
  }));

  return Response.json({ object: "list", data });
}
