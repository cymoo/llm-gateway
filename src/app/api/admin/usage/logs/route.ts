import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { usageLogs, users, models } from "@/lib/db/schema";
import { sql, eq, and, gte, lte, desc } from "drizzle-orm";
import { getAdminUser, unauthorizedResponse } from "@/app/api/admin/middleware";

function escapeCsvValue(value: unknown): string {
  const text = value == null ? "" : String(value);
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replace(/"/g, '""')}"`;
}

function toCsv(logs: Array<{
  id: string;
  userName: string | null;
  modelAlias: string | null;
  requestType: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  isStream: boolean | null;
  durationMs: number | null;
  status: string | null;
  createdAt: Date | null;
}>): string {
  const header = [
    "id",
    "time",
    "user",
    "model",
    "type",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "stream",
    "duration_ms",
    "status",
  ];
  const rows = logs.map((log) =>
    [
      log.id,
      log.createdAt ? log.createdAt.toISOString() : "",
      log.userName ?? "",
      log.modelAlias ?? "",
      log.requestType,
      log.promptTokens ?? 0,
      log.completionTokens ?? 0,
      log.totalTokens ?? 0,
      log.isStream ?? false,
      log.durationMs ?? "",
      log.status ?? "",
    ]
      .map(escapeCsvValue)
      .join(",")
  );

  return [header.join(","), ...rows].join("\n");
}

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
  const format = searchParams.get("format");
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

  if (format === "csv") {
    const logs = await db
      .select({
        id: usageLogs.id,
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
      .orderBy(desc(usageLogs.createdAt));

    const csv = toCsv(logs);
    const fileStart = startDate || "all";
    const fileEnd = endDate || "all";
    const filename = `usage-logs-${fileStart}-${fileEnd}.csv`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

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
