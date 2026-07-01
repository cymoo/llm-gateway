import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { sql, eq, and, gte, lte, or, ilike, desc } from "drizzle-orm";
import { getAdminUser, unauthorizedResponse } from "@/app/api/admin/middleware";

function escapeCsvValue(value: unknown): string {
  const text = value == null ? "" : String(value);
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replace(/"/g, '""')}"`;
}

type AuditRow = {
  id: string;
  createdAt: Date | null;
  adminEmail: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  resourceLabel: string | null;
  status: string;
  changes: unknown;
  metadata: unknown;
  clientIp: string | null;
  userAgent: string | null;
};

function toCsv(rows: AuditRow[]): string {
  const header = [
    "id",
    "time",
    "admin",
    "action",
    "resource_type",
    "resource_id",
    "resource_label",
    "status",
    "changes",
    "metadata",
    "client_ip",
    "user_agent",
  ];
  const body = rows.map((r) =>
    [
      r.id,
      r.createdAt ? r.createdAt.toISOString() : "",
      r.adminEmail ?? "",
      r.action,
      r.resourceType ?? "",
      r.resourceId ?? "",
      r.resourceLabel ?? "",
      r.status,
      r.changes != null ? JSON.stringify(r.changes) : "",
      r.metadata != null ? JSON.stringify(r.metadata) : "",
      r.clientIp ?? "",
      r.userAgent ?? "",
    ]
      .map(escapeCsvValue)
      .join(",")
  );
  return [header.join(","), ...body].join("\n");
}

export async function GET(req: NextRequest) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { searchParams } = new URL(req.url);
  const pageRaw = parseInt(searchParams.get("page") || "1", 10);
  const limitRaw = parseInt(searchParams.get("limit") || "50", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 50;
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const adminId = searchParams.get("adminId");
  const action = searchParams.get("action");
  const resourceType = searchParams.get("resourceType");
  const resourceId = searchParams.get("resourceId");
  const status = searchParams.get("status");
  const q = searchParams.get("q");
  const format = searchParams.get("format");
  const offset = (page - 1) * limit;

  const parseDate = (value: string | null, suffix: string): Date | null => {
    if (!value) return null;
    const d = new Date(value + suffix);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const start = parseDate(startDate, "T00:00:00Z");
  const end = parseDate(endDate, "T23:59:59Z");

  const conditions = [];
  if (start) conditions.push(gte(auditLogs.createdAt, start));
  if (end) conditions.push(lte(auditLogs.createdAt, end));
  if (adminId) conditions.push(eq(auditLogs.adminId, adminId));
  if (action) conditions.push(eq(auditLogs.action, action));
  if (resourceType) conditions.push(eq(auditLogs.resourceType, resourceType));
  if (resourceId) conditions.push(eq(auditLogs.resourceId, resourceId));
  if (status) conditions.push(eq(auditLogs.status, status));
  if (q)
    conditions.push(
      or(
        ilike(auditLogs.adminEmail, `%${q}%`),
        ilike(auditLogs.resourceLabel, `%${q}%`)
      )
    );

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const columns = {
    id: auditLogs.id,
    createdAt: auditLogs.createdAt,
    adminId: auditLogs.adminId,
    adminEmail: auditLogs.adminEmail,
    action: auditLogs.action,
    resourceType: auditLogs.resourceType,
    resourceId: auditLogs.resourceId,
    resourceLabel: auditLogs.resourceLabel,
    status: auditLogs.status,
    changes: auditLogs.changes,
    metadata: auditLogs.metadata,
    clientIp: auditLogs.clientIp,
    userAgent: auditLogs.userAgent,
  };

  if (format === "csv") {
    const rows = await db
      .select(columns)
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt));

    const csv = toCsv(rows as AuditRow[]);
    // Only allow a strict YYYY-MM-DD in the filename to avoid header injection.
    const safeLabel = (s: string | null) =>
      s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "all";
    const filename = `audit-logs-${safeLabel(startDate)}-${safeLabel(endDate)}.csv`;
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
      .from(auditLogs)
      .where(whereClause),
    db
      .select(columns)
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset),
  ]);

  return Response.json({
    data: logs,
    total: Number(totalResult[0].count),
    page,
    limit,
  });
}
