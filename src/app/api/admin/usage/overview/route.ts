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
    activeModels,
    todayStats,
    last7Stats,
    last30Stats,
    dailyTrend,
  ] = await Promise.all([
    db.select({ count: count() }).from(users),
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
    dailyTrend,
  });
}
