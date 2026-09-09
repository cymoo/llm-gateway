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
import { resolveEffectiveQuota } from "@/lib/quota/checker";

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

  // Fetch accessible models: the union of the group's models (for a non-default
  // group) and the user's own authorized models. Retain both sources on
  // overlap so the dashboard shows the same effective quota as the proxy.
  type ModelRow = {
    modelId: string;
    alias: string;
    isActive: boolean | null;
    defaultMaxTokensPerDay: number | null;
    defaultMaxRequestsPerDay: number | null;
    defaultMaxRequestsPerMin: number | null;
    defaultAllowedTimeStart: string | null;
    defaultAllowedTimeEnd: string | null;
    viaGroup: boolean;
    viaUser: boolean;
  };

  const modelColumns = {
    modelId: models.id,
    alias: models.alias,
    isActive: models.isActive,
    defaultMaxTokensPerDay: models.defaultMaxTokensPerDay,
    defaultMaxRequestsPerDay: models.defaultMaxRequestsPerDay,
    defaultMaxRequestsPerMin: models.defaultMaxRequestsPerMin,
    defaultAllowedTimeStart: models.defaultAllowedTimeStart,
    defaultAllowedTimeEnd: models.defaultAllowedTimeEnd,
  };

  type ModelColumnRow = Omit<ModelRow, "viaGroup" | "viaUser">;

  const [groupModelRows, userModelRows] = await Promise.all([
    !isDefaultGroup && group
      ? db
          .select(modelColumns)
          .from(groupModels)
          .innerJoin(models, eq(groupModels.modelId, models.id))
          .where(eq(groupModels.groupId, group.id))
      : Promise.resolve<ModelColumnRow[]>([]),
    db
      .select(modelColumns)
      .from(userModels)
      .innerJoin(models, eq(userModels.modelId, models.id))
      .where(eq(userModels.userId, userId)),
  ]);

  const modelMap = new Map<string, ModelRow>();
  for (const m of groupModelRows) {
    modelMap.set(m.modelId, { ...m, viaGroup: true, viaUser: false });
  }
  for (const m of userModelRows) {
    const existing = modelMap.get(m.modelId);
    modelMap.set(m.modelId, existing
      ? { ...existing, viaUser: true }
      : { ...m, viaGroup: false, viaUser: true });
  }
  const authorizedModels = Array.from(modelMap.values());

  const modelIds = authorizedModels.map((m) => m.modelId);

  // Fetch quota overrides from both sources for strictest-wins resolution.
  type QuotaRow = {
    modelId: string | null;
    maxTokensPerDay: number | null;
    maxRequestsPerDay: number | null;
    maxRequestsPerMin: number | null;
    allowedTimeStart: string | null;
    allowedTimeEnd: string | null;
  };

  let groupQuotaMap = new Map<string | null, QuotaRow>();
  let userQuotaMap = new Map<string | null, QuotaRow>();

  if (modelIds.length > 0) {
    const [groupQuotas, userQuotas] = await Promise.all([
      !isDefaultGroup && group
        ? db
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
            )
        : Promise.resolve<QuotaRow[]>([]),
      db
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
        ),
    ]);

    groupQuotaMap = new Map(groupQuotas.map((q) => [q.modelId, q]));
    userQuotaMap = new Map(userQuotas.map((q) => [q.modelId, q]));
  }

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
    const effective = resolveEffectiveQuota(
      {
        viaUser: m.viaUser,
        groupId: m.viaGroup && group ? group.id : undefined,
      },
      {
        maxTokensPerDay: m.defaultMaxTokensPerDay,
        maxRequestsPerDay: m.defaultMaxRequestsPerDay,
        maxRequestsPerMin: m.defaultMaxRequestsPerMin,
        allowedTimeStart: m.defaultAllowedTimeStart,
        allowedTimeEnd: m.defaultAllowedTimeEnd,
      },
      userQuotaMap.get(m.modelId),
      groupQuotaMap.get(m.modelId),
    );
    const usage = usageMap.get(m.modelId);
    const singleWindow = effective.allowedTimeWindows.length === 1
      ? effective.allowedTimeWindows[0]
      : null;
    return {
      alias: m.alias,
      isActive: m.isActive,
      quota: {
        maxTokensPerDay: effective.maxTokensPerDay,
        maxRequestsPerDay: effective.maxRequestsPerDay,
        maxRequestsPerMin: effective.maxRequestsPerMin,
        allowedTimeStart: singleWindow?.start ?? null,
        allowedTimeEnd: singleWindow?.end ?? null,
        allowedTimeWindows: effective.allowedTimeWindows,
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
