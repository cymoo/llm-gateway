import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  users,
  models,
  userModels,
  userModelQuotas,
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

  const [
    userRows,
    todayStats,
    dailyTrend,
    authorizedModels,
  ] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        apiKey: users.apiKey,
        isAdmin: users.isAdmin,
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

    db
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
      .where(eq(userModels.userId, userId)),
  ]);

  if (userRows.length === 0) return unauthorizedResponse();

  const user = userRows[0];

  // Fetch per-user quota overrides for authorized models
  const modelIds = authorizedModels.map((m) => m.modelId);
  let quotaOverrides: Array<{
    modelId: string | null;
    maxTokensPerDay: number | null;
    maxRequestsPerDay: number | null;
    maxRequestsPerMin: number | null;
    allowedTimeStart: string | null;
    allowedTimeEnd: string | null;
  }> = [];

  if (modelIds.length > 0) {
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
  }

  const quotaMap = new Map(
    quotaOverrides.map((q) => [q.modelId, q])
  );

  // Fetch today's per-model usage for the user
  const todayModelUsage = modelIds.length > 0
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

  const usageMap = new Map(
    todayModelUsage.map((u) => [u.modelId, u])
  );

  const modelsWithQuotas = authorizedModels.map((m) => {
    const override = quotaMap.get(m.modelId);
    const usage = usageMap.get(m.modelId);
    return {
      alias: m.alias,
      isActive: m.isActive,
      quota: {
        maxTokensPerDay: override?.maxTokensPerDay ?? m.defaultMaxTokensPerDay,
        maxRequestsPerDay: override?.maxRequestsPerDay ?? m.defaultMaxRequestsPerDay,
        maxRequestsPerMin: override?.maxRequestsPerMin ?? m.defaultMaxRequestsPerMin,
        allowedTimeStart: override?.allowedTimeStart ?? m.defaultAllowedTimeStart,
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

  return Response.json({
    user: {
      name: user.name,
      email: user.email,
      apiKey: user.apiKey,
      isAdmin: user.isAdmin,
    },
    today: {
      totalTokens: todayStats[0].totalTokens,
      requestCount: todayStats[0].requestCount,
    },
    dailyTrend,
    models: modelsWithQuotas,
    baseUrl,
  });
}
