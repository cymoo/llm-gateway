import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  users,
  groups,
  models,
  userModels,
  groupModels,
  dailyUsage,
} from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getAuthUser, unauthorizedResponse } from "@/app/api/auth/middleware";
import { getTodayStr } from "@/lib/usage/date";

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return unauthorizedResponse();

  const userId = authUser.userId;

  const now = new Date();
  const today = getTodayStr(now);

  const d7 = new Date(now);
  d7.setDate(d7.getDate() - 6);
  const date7 = getTodayStr(d7);

  const [userRows, todayStats, dailyTrend] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        apiKey: users.apiKey,
        isAdmin: users.isAdmin,
        groupId: users.groupId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),

    db
      .select({
        totalTokens: sql<number>`coalesce(sum(${dailyUsage.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${dailyUsage.requestCount}), 0)`,
      })
      .from(dailyUsage)
      .where(
        and(
          eq(dailyUsage.userId, userId),
          sql`${dailyUsage.date} = ${today}`
        )
      ),

    db
      .select({
        date: dailyUsage.date,
        totalTokens: sql<number>`coalesce(sum(${dailyUsage.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${dailyUsage.requestCount}), 0)`,
      })
      .from(dailyUsage)
      .where(
        and(
          eq(dailyUsage.userId, userId),
          sql`${dailyUsage.date} >= ${date7}`
        )
      )
      .groupBy(dailyUsage.date)
      .orderBy(dailyUsage.date),
  ]);

  if (userRows.length === 0) return unauthorizedResponse();

  const user = userRows[0];

  // Determine group membership
  const groupRows = user.groupId
    ? await db.select().from(groups).where(eq(groups.id, user.groupId)).limit(1)
    : [];
  const group = groupRows[0];
  const isDefaultGroup = !group || group.isDefault;

  // Combine personal and non-default group model access without returning
  // quota configuration to the user dashboard.
  type ModelRow = {
    modelId: string;
    alias: string;
    isActive: boolean | null;
  };
  const modelColumns = {
    modelId: models.id,
    alias: models.alias,
    isActive: models.isActive,
  };

  const [groupModelRows, userModelRows] = await Promise.all([
    !isDefaultGroup && group
      ? db
          .select(modelColumns)
          .from(groupModels)
          .innerJoin(models, eq(groupModels.modelId, models.id))
          .where(eq(groupModels.groupId, group.id))
      : Promise.resolve<ModelRow[]>([]),
    db
      .select(modelColumns)
      .from(userModels)
      .innerJoin(models, eq(userModels.modelId, models.id))
      .where(eq(userModels.userId, userId)),
  ]);

  const modelMap = new Map<string, ModelRow>();
  for (const model of [...groupModelRows, ...userModelRows]) {
    modelMap.set(model.modelId, model);
  }
  const authorizedModels = Array.from(modelMap.values());
  const modelIds = authorizedModels.map((m) => m.modelId);

  // Fetch today's per-model usage
  const todayModelUsage =
    modelIds.length > 0
      ? await db
          .select({
            modelId: dailyUsage.modelId,
            totalTokens: sql<number>`coalesce(${dailyUsage.totalTokens}, 0)`,
            requestCount: sql<number>`coalesce(${dailyUsage.requestCount}, 0)`,
          })
          .from(dailyUsage)
          .where(
            and(
              eq(dailyUsage.userId, userId),
              sql`${dailyUsage.date} = ${today}`,
              inArray(dailyUsage.modelId, modelIds)
            )
          )
      : [];

  const usageMap = new Map(todayModelUsage.map((u) => [u.modelId, u]));

  // Per-model token usage over last 7 days for pie chart
  const modelStats =
    modelIds.length > 0
      ? await db
          .select({
            modelId: dailyUsage.modelId,
            totalTokens: sql<number>`coalesce(sum(${dailyUsage.totalTokens}), 0)`,
            requestCount: sql<number>`coalesce(sum(${dailyUsage.requestCount}), 0)`,
          })
          .from(dailyUsage)
          .where(
            and(
              eq(dailyUsage.userId, userId),
              sql`${dailyUsage.date} >= ${date7}`,
              inArray(dailyUsage.modelId, modelIds)
            )
          )
          .groupBy(dailyUsage.modelId)
      : [];

  const modelAliasMap = new Map(authorizedModels.map((m) => [m.modelId, m.alias]));
  const modelStatsMapped = modelStats
    .map((s) => ({
      alias: modelAliasMap.get(s.modelId ?? "") ?? s.modelId ?? "",
      totalTokens: Number(s.totalTokens),
      requestCount: Number(s.requestCount),
    }))
    .filter((s) => s.totalTokens > 0 || s.requestCount > 0);

  const modelsWithUsage = authorizedModels.map((m) => {
    const usage = usageMap.get(m.modelId);
    return {
      alias: m.alias,
      isActive: m.isActive,
      todayUsage: {
        totalTokens: Number(usage?.totalTokens ?? 0),
        requestCount: Number(usage?.requestCount ?? 0),
      },
    };
  });

  const host = process.env.HOST || req.headers.get("host") || "localhost:3000";
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  const baseUrl = `${proto}://${host}/api/v1`;
  const anthropicBaseUrl = `${proto}://${host}/api/anthropic`;

  return Response.json({
    user: {
      name: user.name,
      email: user.email,
      apiKey: user.apiKey,
      isAdmin: user.isAdmin,
    },
    group: group
      ? { name: group.name, isDefault: group.isDefault }
      : { name: "Default", isDefault: true },
    today: {
      totalTokens: todayStats[0].totalTokens,
      requestCount: todayStats[0].requestCount,
    },
    dailyTrend,
    models: modelsWithUsage,
    modelStats: modelStatsMapped,
    baseUrl,
    anthropicBaseUrl,
  });
}
