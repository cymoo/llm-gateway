import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  users,
  groups,
  models,
  userModels,
  userModelQuotas,
  groupModels,
  groupModelQuotas,
  dailyUsage,
} from "@/lib/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getAuthUser, unauthorizedResponse } from "@/app/api/auth/middleware";

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return unauthorizedResponse();

  const userId = authUser.userId;

  const now = new Date();
  const today = now.toISOString().split("T")[0];

  const d7 = new Date(now);
  d7.setDate(d7.getDate() - 6);
  const date7 = d7.toISOString().split("T")[0];

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

  // Fetch accessible models based on group membership
  type ModelRow = {
    modelId: string;
    alias: string;
    isActive: boolean | null;
    defaultMaxTokensPerDay: number | null;
    defaultMaxRequestsPerDay: number | null;
    defaultMaxRequestsPerMin: number | null;
    defaultAllowedTimeStart: string | null;
    defaultAllowedTimeEnd: string | null;
  };

  let authorizedModels: ModelRow[];

  if (isDefaultGroup) {
    authorizedModels = await db
      .select({
        modelId: models.id,
        alias: models.alias,
        isActive: models.isActive,
        defaultMaxTokensPerDay: models.defaultMaxTokensPerDay,
        defaultMaxRequestsPerDay: models.defaultMaxRequestsPerDay,
        defaultMaxRequestsPerMin: models.defaultMaxRequestsPerMin,
        defaultAllowedTimeStart: models.defaultAllowedTimeStart,
        defaultAllowedTimeEnd: models.defaultAllowedTimeEnd,
      })
      .from(userModels)
      .innerJoin(models, eq(userModels.modelId, models.id))
      .where(eq(userModels.userId, userId));
  } else {
    authorizedModels = await db
      .select({
        modelId: models.id,
        alias: models.alias,
        isActive: models.isActive,
        defaultMaxTokensPerDay: models.defaultMaxTokensPerDay,
        defaultMaxRequestsPerDay: models.defaultMaxRequestsPerDay,
        defaultMaxRequestsPerMin: models.defaultMaxRequestsPerMin,
        defaultAllowedTimeStart: models.defaultAllowedTimeStart,
        defaultAllowedTimeEnd: models.defaultAllowedTimeEnd,
      })
      .from(groupModels)
      .innerJoin(models, eq(groupModels.modelId, models.id))
      .where(eq(groupModels.groupId, group.id));
  }

  const modelIds = authorizedModels.map((m) => m.modelId);

  // Fetch quota overrides based on group membership
  type QuotaRow = {
    modelId: string | null;
    maxTokensPerDay: number | null;
    maxRequestsPerDay: number | null;
    maxRequestsPerMin: number | null;
    allowedTimeStart: string | null;
    allowedTimeEnd: string | null;
  };

  let quotaOverrides: QuotaRow[] = [];

  if (modelIds.length > 0) {
    if (isDefaultGroup) {
      quotaOverrides = await db
        .select({
          modelId: userModelQuotas.modelId,
          maxTokensPerDay: userModelQuotas.maxTokensPerDay,
          maxRequestsPerDay: userModelQuotas.maxRequestsPerDay,
          maxRequestsPerMin: userModelQuotas.maxRequestsPerMin,
          allowedTimeStart: userModelQuotas.allowedTimeStart,
          allowedTimeEnd: userModelQuotas.allowedTimeEnd,
        })
        .from(userModelQuotas)
        .where(
          and(
            eq(userModelQuotas.userId, userId),
            inArray(userModelQuotas.modelId, modelIds)
          )
        );
    } else {
      quotaOverrides = await db
        .select({
          modelId: groupModelQuotas.modelId,
          maxTokensPerDay: groupModelQuotas.maxTokensPerDay,
          maxRequestsPerDay: groupModelQuotas.maxRequestsPerDay,
          maxRequestsPerMin: groupModelQuotas.maxRequestsPerMin,
          allowedTimeStart: groupModelQuotas.allowedTimeStart,
          allowedTimeEnd: groupModelQuotas.allowedTimeEnd,
        })
        .from(groupModelQuotas)
        .where(
          and(
            eq(groupModelQuotas.groupId, group.id),
            inArray(groupModelQuotas.modelId, modelIds)
          )
        );
    }
  }

  const quotaMap = new Map(quotaOverrides.map((q) => [q.modelId, q]));

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

  const modelsWithQuotas = authorizedModels.map((m) => {
    const override = quotaMap.get(m.modelId);
    const usage = usageMap.get(m.modelId);
    return {
      alias: m.alias,
      isActive: m.isActive,
      quota: {
        maxTokensPerDay: override?.maxTokensPerDay ?? m.defaultMaxTokensPerDay,
        maxRequestsPerDay:
          override?.maxRequestsPerDay ?? m.defaultMaxRequestsPerDay,
        maxRequestsPerMin:
          override?.maxRequestsPerMin ?? m.defaultMaxRequestsPerMin,
        allowedTimeStart:
          override?.allowedTimeStart ?? m.defaultAllowedTimeStart,
        allowedTimeEnd: override?.allowedTimeEnd ?? m.defaultAllowedTimeEnd,
      },
      todayUsage: {
        totalTokens: usage?.totalTokens ?? 0,
        requestCount: usage?.requestCount ?? 0,
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
    models: modelsWithQuotas,
    modelStats: modelStatsMapped,
    baseUrl,
    anthropicBaseUrl,
  });
}
