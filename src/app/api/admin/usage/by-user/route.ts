import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, dailyUsage } from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";
import { getAdminUser, unauthorizedResponse } from "@/app/api/admin/middleware";

export async function GET(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const conditions = [];
  if (startDate) conditions.push(sql`${dailyUsage.date} >= ${startDate}`);
  if (endDate) conditions.push(sql`${dailyUsage.date} <= ${endDate}`);

  const whereClause =
    conditions.length > 0
      ? sql`${conditions.reduce((a, b) => sql`${a} AND ${b}`)}`
      : undefined;

  const result = await db
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
    .orderBy(sql`sum(${dailyUsage.totalTokens}) desc`);

  return Response.json(result);
}
