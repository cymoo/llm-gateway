import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, models, dailyUsage } from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";
import { getAdminUser, unauthorizedResponse } from "@/app/api/admin/middleware";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const conditions = [sql`${dailyUsage.modelId} = ${id}`];
  if (startDate) conditions.push(sql`${dailyUsage.date} >= ${startDate}`);
  if (endDate) conditions.push(sql`${dailyUsage.date} <= ${endDate}`);

  const whereClause = conditions.reduce((a, b) => sql`${a} AND ${b}`);

  const [modelInfo, usageByUser, dailyTrend] = await Promise.all([
    db.select().from(models).where(eq(models.id, id)).limit(1),
    db
      .select({
        userId: dailyUsage.userId,
        userName: users.name,
        userEmail: users.email,
        totalTokens: sql<number>`coalesce(sum(${dailyUsage.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${dailyUsage.requestCount}), 0)`,
      })
      .from(dailyUsage)
      .innerJoin(users, eq(dailyUsage.userId, users.id))
      .where(whereClause)
      .groupBy(dailyUsage.userId, users.name, users.email)
      .orderBy(sql`sum(${dailyUsage.requestCount}) desc`),
    db
      .select({
        date: dailyUsage.date,
        totalTokens: sql<number>`coalesce(sum(${dailyUsage.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${dailyUsage.requestCount}), 0)`,
      })
      .from(dailyUsage)
      .where(whereClause)
      .groupBy(dailyUsage.date)
      .orderBy(dailyUsage.date),
  ]);

  return Response.json({
    model: modelInfo[0] || null,
    usageByUser,
    dailyTrend,
  });
}
