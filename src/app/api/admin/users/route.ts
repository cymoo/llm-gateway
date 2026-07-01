import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, groups, userModels, dailyUsage } from "@/lib/db/schema";
import { eq, ilike, or, count, sql, and, inArray } from "drizzle-orm";
import { getAdminUser, unauthorizedResponse } from "@/app/api/admin/middleware";
import { generateApiKey } from "@/lib/utils/api-key";
import { recordAudit, diff } from "@/lib/audit/recorder";

export async function GET(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const search = searchParams.get("search") || "";
  const offset = (page - 1) * limit;

  const conditions = search
    ? or(
        ilike(users.name, `%${search}%`),
        ilike(users.email, `%${search}%`)
      )
    : undefined;

  const [totalResult, userList] = await Promise.all([
    db
      .select({ count: count() })
      .from(users)
      .where(conditions),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        apiKey: users.apiKey,
        remark: users.remark,
        isActive: users.isActive,
        isAdmin: users.isAdmin,
        createdAt: users.createdAt,
        groupId: users.groupId,
        groupName: groups.name,
      })
      .from(users)
      .leftJoin(groups, eq(users.groupId, groups.id))
      .where(conditions)
      .orderBy(users.createdAt)
      .limit(limit)
      .offset(offset),
  ]);

  const today = new Date().toISOString().split("T")[0];

  // Get model counts and today's usage for each user
  const userIds = userList.map((u) => u.id);

  const modelCounts = userIds.length > 0
    ? await db
        .select({ userId: userModels.userId, count: count() })
        .from(userModels)
        .where(
          userIds.length === 1
            ? eq(userModels.userId, userIds[0])
            : inArray(userModels.userId, userIds)
        )
        .groupBy(userModels.userId)
    : [];

  const todayUsage = userIds.length > 0
    ? await db
        .select({
          userId: dailyUsage.userId,
          totalTokens: sql<number>`sum(${dailyUsage.totalTokens})`,
          requestCount: sql<number>`sum(${dailyUsage.requestCount})`,
        })
        .from(dailyUsage)
        .where(
          and(
            eq(dailyUsage.date, today),
            userIds.length === 1
              ? eq(dailyUsage.userId, userIds[0])
              : inArray(dailyUsage.userId, userIds)
          )
        )
        .groupBy(dailyUsage.userId)
    : [];

  const modelCountMap = new Map(modelCounts.map((r) => [r.userId, r.count]));
  const usageMap = new Map(todayUsage.map((r) => [r.userId, r]));

  const result = userList.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    apiKey: u.apiKey,
    remark: u.remark,
    isActive: u.isActive,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
    groupId: u.groupId,
    groupName: u.groupName,
    modelCount: modelCountMap.get(u.id) || 0,
    todayTokens: usageMap.get(u.id)?.totalTokens || 0,
    todayRequests: usageMap.get(u.id)?.requestCount || 0,
  }));

  return Response.json({
    data: result,
    total: totalResult[0].count,
    page,
    limit,
  });
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { name, email, remark } = await req.json();

  if (!name || !email) {
    return Response.json({ error: "Name and email are required" }, { status: 400 });
  }

  const apiKey = generateApiKey();

  // Look up the Default group to assign to new users
  const defaultGroupRows = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.isDefault, true))
    .limit(1);
  const defaultGroupId = defaultGroupRows[0]?.id ?? null;

  try {
    const [user] = await db
      .insert(users)
      .values({ name, email, apiKey, remark, isActive: true, isAdmin: false, groupId: defaultGroupId })
      .returning();

    recordAudit({
      adminId: admin.userId,
      adminEmail: admin.email,
      action: "user.create",
      resourceType: "user",
      resourceId: user.id,
      resourceLabel: user.email,
      changes: diff(null, user),
      req,
    });

    return Response.json(user, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return Response.json({ error: "Email already exists" }, { status: 409 });
    }
    throw err;
  }
}
