import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { getClientIp, getUserAgent } from "@/lib/utils/request";

/**
 * Keys that must never be persisted to the audit trail. Matched
 * case-insensitively against object keys before storing any payload.
 */
const SECRET_KEYS = new Set([
  "password",
  "passwordhash",
  "apikey",
  "backendapikey",
  "token",
]);

const REDACTED = "[REDACTED]";

/** Noisy/bookkeeping keys excluded from diffs. */
const IGNORE_KEYS = new Set(["createdat", "updatedat"]);

/** Recurse into arrays and plain objects so secrets nested in payloads
 *  (e.g. a model's backends[].backendApiKey) are redacted too. */
function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return redactSecrets(value as Record<string, unknown>);
  }
  return value;
}

/**
 * Return a copy with secret fields replaced by a placeholder and bookkeeping
 * fields dropped, recursing into nested arrays/objects. Used for one-sided
 * create/delete payloads.
 */
export function redactSecrets(
  obj: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (IGNORE_KEYS.has(lower)) continue;
    out[key] = SECRET_KEYS.has(lower) ? REDACTED : redactValue(value);
  }
  return out;
}

export interface AuditDiff {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * Compute a field-level before→after diff limited to keys that actually
 * changed. Change detection compares raw values, but the stored values are
 * redacted so a secret change is visible ("[REDACTED]" → "[REDACTED]") without
 * ever leaking the secret itself.
 * - create: pass before=null → returns { after } (full redacted payload)
 * - delete: pass after=null → returns { before }
 * - update: returns only the changed keys
 */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): AuditDiff {
  if (before && !after) return { before: redactSecrets(before) ?? {} };
  if (!before && after) return { after: redactSecrets(after) ?? {} };
  if (!before && !after) return {};

  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before!), ...Object.keys(after!)]);
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (IGNORE_KEYS.has(lower)) continue;
    const b = before![key];
    const a = after![key];
    if (Object.is(b, a) || JSON.stringify(b) === JSON.stringify(a)) continue;
    const isSecret = SECRET_KEYS.has(lower);
    changedBefore[key] = isSecret ? REDACTED : redactValue(b);
    changedAfter[key] = isSecret ? REDACTED : redactValue(a);
  }
  return { before: changedBefore, after: changedAfter };
}

export interface AuditActor {
  adminId: string | null;
  adminEmail: string | null;
}

export interface AuditRecord {
  adminId?: string | null;
  adminEmail?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  resourceLabel?: string | null;
  status?: "success" | "failure";
  changes?: AuditDiff | null;
  metadata?: Record<string, unknown> | null;
  req?: NextRequest;
  clientIp?: string | null;
  userAgent?: string | null;
}

/**
 * Record an admin audit event. Non-blocking (fires after the response is
 * sent) and failure-tolerant — auditing must never break the admin action.
 */
/** Truncate to the column length so an oversized (possibly attacker-supplied)
 *  value can never make the audit INSERT throw and silently drop the record. */
function cap(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/** Enforce redaction at the sink: even if a caller passes an un-redacted
 *  payload, secrets never reach the audit_logs table. Idempotent with diff(). */
export function sanitizeDiff(d: AuditDiff | null | undefined): AuditDiff | null {
  if (!d) return null;
  const out: AuditDiff = {};
  if (d.before) out.before = redactSecrets(d.before) ?? {};
  if (d.after) out.after = redactSecrets(d.after) ?? {};
  return out;
}

export function recordAudit(record: AuditRecord): void {
  const clientIp =
    record.clientIp ?? (record.req ? getClientIp(record.req) : null);
  const userAgent =
    record.userAgent ?? (record.req ? getUserAgent(record.req) : null);

  setImmediate(async () => {
    try {
      await db.insert(auditLogs).values({
        adminId: record.adminId ?? null,
        adminEmail: cap(record.adminEmail, 255),
        action: cap(record.action, 50) ?? record.action,
        resourceType: cap(record.resourceType, 50),
        resourceId: cap(record.resourceId, 64),
        resourceLabel: cap(record.resourceLabel, 255),
        status: cap(record.status ?? "success", 20) ?? "success",
        changes: sanitizeDiff(record.changes),
        metadata: redactSecrets(record.metadata),
        clientIp: cap(clientIp, 45),
        userAgent: cap(userAgent, 512),
      });
    } catch (err) {
      console.error("[audit] Failed to record audit event:", err);
    }
  });
}
