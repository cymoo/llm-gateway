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

  const conditions = [sql`${dailyUsage.userId} = ${id}`];
  if (startDate) conditions.push(sql`${dailyUsage.date} >= ${startDate}`);
  if (endDate) conditions.push(sql`${dailyUsage.date} <= ${endDate}`);

  const whereClause = conditions.reduce((a, b) => sql`${a} AND ${b}`);

  const [userInfo, usageByModel, dailyTrend] = await Promise.all([
    db.select().from(users).where(eq(users.id, id)).limit(1),
    db
      .select({
        modelId: dailyUsage.modelId,
        modelAlias: models.alias,
        totalTokens: sql<number>`coalesce(sum(${dailyUsage.totalTokens}), 0)`,
        requestCount: sql<number>`coalesce(sum(${dailyUsage.requestCount}), 0)`,
      })
      .from(dailyUsage)
      .innerJoin(models, eq(dailyUsage.modelId, models.id))
      .where(whereClause)
      .groupBy(dailyUsage.modelId, models.alias)
      .orderBy(sql`sum(${dailyUsage.totalTokens}) desc`),
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
    user: userInfo[0] || null,
    usageByModel,
    dailyTrend,
  });
}
