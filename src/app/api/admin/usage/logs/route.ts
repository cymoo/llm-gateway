import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { usageLogs, users, models } from "@/lib/db/schema";
import { sql, eq, and, gte, lte, desc } from "drizzle-orm";
import { getAdminUser, unauthorizedResponse } from "@/app/api/admin/middleware";

export async function GET(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const userId = searchParams.get("userId");
  const modelId = searchParams.get("modelId");
  const offset = (page - 1) * limit;

  const conditions = [];
  if (startDate)
    conditions.push(
      gte(usageLogs.createdAt, new Date(startDate + "T00:00:00Z"))
    );
  if (endDate)
    conditions.push(
      lte(usageLogs.createdAt, new Date(endDate + "T23:59:59Z"))
    );
  if (userId) conditions.push(eq(usageLogs.userId, userId));
  if (modelId) conditions.push(eq(usageLogs.modelId, modelId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult, logs] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(usageLogs)
      .where(whereClause),
    db
      .select({
        id: usageLogs.id,
        userId: usageLogs.userId,
        modelId: usageLogs.modelId,
        userName: users.name,
        modelAlias: models.alias,
        requestType: usageLogs.requestType,
        promptTokens: usageLogs.promptTokens,
        completionTokens: usageLogs.completionTokens,
        totalTokens: usageLogs.totalTokens,
        isStream: usageLogs.isStream,
        durationMs: usageLogs.durationMs,
        status: usageLogs.status,
        createdAt: usageLogs.createdAt,
      })
      .from(usageLogs)
      .leftJoin(users, eq(usageLogs.userId, users.id))
      .leftJoin(models, eq(usageLogs.modelId, models.id))
      .where(whereClause)
      .orderBy(desc(usageLogs.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  return Response.json({
    data: logs,
    total: totalResult[0].count,
    page,
    limit,
  });
}
