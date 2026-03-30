import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, models, dailyUsage, usageLogs } from "@/lib/db/schema";
import { sql, gte, count } from "drizzle-orm";
import { getAdminUser, unauthorizedResponse } from "@/app/api/admin/middleware";

export async function GET(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const now = new Date();
  const today = now.toISOString().split("T")[0];

  const d7 = new Date(now);
  d7.setDate(d7.getDate() - 6);
  const date7 = d7.toISOString().split("T")[0];

  const d30 = new Date(now);
  d30.setDate(d30.getDate() - 29);
  const date30 = d30.toISOString().split("T")[0];

  const [
    totalUsers,
    totalModels,
    activeModels,
    todayStats,
    last7Stats,
    last30Stats,
    allTimeStats,
    activeLast7Days,
    recentLogStats,
    dailyTrend,
  ] = await Promise.all([
    db.select({ count: count() }).from(users),
    db.select({ count: count() }).from(models),
    db
      .select({ count: count() })
      .from(models)
      .where(sql`${models.isActive} = true`),
    db
      .select({
        totalTokens: sql<number>`coalesce(sum(${dailyUsage.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${dailyUsage.requestCount}), 0)`,
      })
      .from(dailyUsage)
      .where(sql`${dailyUsage.date} = ${today}`),
    db
      .select({
        totalTokens: sql<number>`coalesce(sum(${dailyUsage.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${dailyUsage.requestCount}), 0)`,
      })
      .from(dailyUsage)
      .where(sql`${dailyUsage.date} >= ${date7}`),
    db
      .select({
        totalTokens: sql<number>`coalesce(sum(${dailyUsage.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${dailyUsage.requestCount}), 0)`,
      })
      .from(dailyUsage)
      .where(sql`${dailyUsage.date} >= ${date30}`),
    db
      .select({
        totalTokens: sql<number>`coalesce(sum(${dailyUsage.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${dailyUsage.requestCount}), 0)`,
      })
      .from(dailyUsage),
    db
      .select({
        activeUsers: sql<number>`count(distinct ${dailyUsage.userId})`,
        activeModels: sql<number>`count(distinct ${dailyUsage.modelId})`,
      })
      .from(dailyUsage)
      .where(sql`${dailyUsage.date} >= ${date7}`),
    db
      .select({
        total: count(),
        success: sql<number>`coalesce(sum(case when ${usageLogs.status} = 'success' then 1 else 0 end), 0)`,
      })
      .from(usageLogs)
      .where(gte(usageLogs.createdAt, new Date(date7 + "T00:00:00Z"))),
    db
      .select({
        date: dailyUsage.date,
        totalTokens: sql<number>`coalesce(sum(${dailyUsage.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${dailyUsage.requestCount}), 0)`,
      })
      .from(dailyUsage)
      .where(sql`${dailyUsage.date} >= ${date7}`)
      .groupBy(dailyUsage.date)
      .orderBy(dailyUsage.date),
  ]);

  return Response.json({
    totalUsers: totalUsers[0].count,
    totalModels: totalModels[0].count,
    activeModels: activeModels[0].count,
    today: {
      totalTokens: todayStats[0].totalTokens,
      requestCount: todayStats[0].requestCount,
    },
    last7Days: {
      totalTokens: last7Stats[0].totalTokens,
      requestCount: last7Stats[0].requestCount,
    },
    last30Days: {
      totalTokens: last30Stats[0].totalTokens,
      requestCount: last30Stats[0].requestCount,
    },
    allTime: {
      totalTokens: allTimeStats[0].totalTokens,
      requestCount: allTimeStats[0].requestCount,
    },
    activeLast7Days: {
      users: activeLast7Days[0].activeUsers,
      models: activeLast7Days[0].activeModels,
    },
    successRate7Days:
      recentLogStats[0].total > 0
        ? Number(
            ((recentLogStats[0].success / recentLogStats[0].total) * 100).toFixed(1)
          )
        : 0,
    dailyTrend,
  });
}
