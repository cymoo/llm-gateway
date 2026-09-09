import { db } from "@/lib/db";
import { userModelQuotas, groupModelQuotas, dailyUsage } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getRateLimiter } from "./rate-limiter";
import { makeProxyError } from "@/lib/proxy/errors";

export interface QuotaAccess {
  viaUser: boolean;
  groupId?: string;
}

export interface QuotaValues {
  maxTokensPerDay: number | null;
  maxRequestsPerDay: number | null;
  maxRequestsPerMin: number | null;
  allowedTimeStart: string | null;
  allowedTimeEnd: string | null;
}

export interface AllowedTimeWindow {
  start: string;
  end: string;
  source: "user" | "group" | "model";
}

export interface EffectiveQuota {
  maxTokensPerDay: number | null;
  maxRequestsPerDay: number | null;
  maxRequestsPerMin: number | null;
  allowedTimeWindows: AllowedTimeWindow[];
}

export interface QuotaContext {
  userId: string;
  modelId: string;
  modelAlias: string;
  access: QuotaAccess;
  defaultMaxTokensPerDay: number | null;
  defaultMaxRequestsPerDay: number | null;
  defaultMaxRequestsPerMin: number | null;
  defaultAllowedTimeStart: string | null;
  defaultAllowedTimeEnd: string | null;
}

type NumericQuotaKey =
  | "maxTokensPerDay"
  | "maxRequestsPerDay"
  | "maxRequestsPerMin";

function mostRestrictiveNumber(
  key: NumericQuotaKey,
  access: QuotaAccess,
  defaults: QuotaValues,
  userQuota?: QuotaValues,
  groupQuota?: QuotaValues,
): number | null {
  const configured: number[] = [];

  if (access.viaUser && userQuota?.[key] != null) {
    configured.push(userQuota[key]);
  }
  if (access.groupId && groupQuota?.[key] != null) {
    configured.push(groupQuota[key]);
  }

  return configured.length > 0 ? Math.min(...configured) : defaults[key];
}

function configuredWindow(
  source: AllowedTimeWindow["source"],
  quota: QuotaValues | undefined,
  defaults: QuotaValues,
): AllowedTimeWindow | null {
  if (!quota || (!quota.allowedTimeStart && !quota.allowedTimeEnd)) return null;

  // Preserve field-level model fallback for legacy partial rows. If no model
  // boundary exists, treat the missing side as open-ended rather than silently
  // dropping the configured restriction.
  const start =
    quota.allowedTimeStart ?? defaults.allowedTimeStart ?? "00:00:00";
  const end = quota.allowedTimeEnd ?? defaults.allowedTimeEnd ?? "23:59:59";
  return { start, end, source };
}

/**
 * Explicit user/group limits are combined field-by-field using the lower
 * value. Model defaults remain fallbacks. Every returned time window must be
 * satisfied, which gives us intersection semantics even across midnight.
 */
export function resolveEffectiveQuota(
  access: QuotaAccess,
  defaults: QuotaValues,
  userQuota?: QuotaValues,
  groupQuota?: QuotaValues,
): EffectiveQuota {
  const allowedTimeWindows: AllowedTimeWindow[] = [];
  const userWindow = access.viaUser
    ? configuredWindow("user", userQuota, defaults)
    : null;
  const groupWindow = access.groupId
    ? configuredWindow("group", groupQuota, defaults)
    : null;

  if (userWindow) allowedTimeWindows.push(userWindow);
  if (groupWindow) allowedTimeWindows.push(groupWindow);
  if (
    allowedTimeWindows.length === 0 &&
    (defaults.allowedTimeStart || defaults.allowedTimeEnd)
  ) {
    allowedTimeWindows.push({
      start: defaults.allowedTimeStart ?? "00:00:00",
      end: defaults.allowedTimeEnd ?? "23:59:59",
      source: "model",
    });
  }

  return {
    maxTokensPerDay: mostRestrictiveNumber(
      "maxTokensPerDay",
      access,
      defaults,
      userQuota,
      groupQuota,
    ),
    maxRequestsPerDay: mostRestrictiveNumber(
      "maxRequestsPerDay",
      access,
      defaults,
      userQuota,
      groupQuota,
    ),
    maxRequestsPerMin: mostRestrictiveNumber(
      "maxRequestsPerMin",
      access,
      defaults,
      userQuota,
      groupQuota,
    ),
    allowedTimeWindows,
  };
}

function getCurrentTimeStr(): string {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, "0");
  const m = now.getMinutes().toString().padStart(2, "0");
  const s = now.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function getTodayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const d = now.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function timeToSeconds(t: string): number {
  const parts = t.split(":");
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + (parseInt(parts[2]) || 0);
}

export function isWithinAllowedWindow(
  now: string,
  window: AllowedTimeWindow,
): boolean {
  const currentSec = timeToSeconds(now);
  const startSec = timeToSeconds(window.start);
  const endSec = timeToSeconds(window.end);
  return startSec <= endSec
    ? currentSec >= startSec && currentSec <= endSec
    : currentSec >= startSec || currentSec <= endSec;
}

export async function checkQuota(
  ctx: QuotaContext
): Promise<Response | null> {
  const { userId, modelId } = ctx;

  const [groupRows, userRows] = await Promise.all([
    ctx.access.groupId
      ? db
          .select()
          .from(groupModelQuotas)
          .where(
            and(
              eq(groupModelQuotas.groupId, ctx.access.groupId),
              eq(groupModelQuotas.modelId, modelId)
            )
          )
          .limit(1)
      : Promise.resolve([]),
    ctx.access.viaUser
      ? db
          .select()
          .from(userModelQuotas)
          .where(
            and(
              eq(userModelQuotas.userId, userId),
              eq(userModelQuotas.modelId, modelId)
            )
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  const defaults: QuotaValues = {
    maxTokensPerDay: ctx.defaultMaxTokensPerDay,
    maxRequestsPerDay: ctx.defaultMaxRequestsPerDay,
    maxRequestsPerMin: ctx.defaultMaxRequestsPerMin,
    allowedTimeStart: ctx.defaultAllowedTimeStart,
    allowedTimeEnd: ctx.defaultAllowedTimeEnd,
  };
  const effective = resolveEffectiveQuota(
    ctx.access,
    defaults,
    userRows[0],
    groupRows[0],
  );

  const currentTime = getCurrentTimeStr();
  for (const window of effective.allowedTimeWindows) {
    if (!isWithinAllowedWindow(currentTime, window)) {
      return makeProxyError(
        `Access is only allowed between ${window.start} and ${window.end}`,
        "permission_error",
        "time_restricted",
        403
      );
    }
  }

  if (effective.maxRequestsPerMin !== null) {
    const limiter = getRateLimiter();
    if (!limiter.check(userId, modelId, effective.maxRequestsPerMin)) {
      return makeProxyError(
        `Rate limit exceeded: max ${effective.maxRequestsPerMin} requests per minute`,
        "rate_limit_error",
        "rate_limit_exceeded",
        429
      );
    }
  }

  if (
    effective.maxRequestsPerDay !== null ||
    effective.maxTokensPerDay !== null
  ) {
    const today = getTodayStr();
    const usageRows = await db
      .select()
      .from(dailyUsage)
      .where(
        and(
          eq(dailyUsage.userId, userId),
          eq(dailyUsage.modelId, modelId),
          eq(dailyUsage.date, today)
        )
      )
      .limit(1);

    const usage = usageRows[0];
    const requestCount = usage?.requestCount ?? 0;
    const totalTokens = usage?.totalTokens ?? 0;

    if (
      effective.maxRequestsPerDay !== null &&
      requestCount >= effective.maxRequestsPerDay
    ) {
      return makeProxyError(
        `Daily request limit exceeded: max ${effective.maxRequestsPerDay} requests per day`,
        "rate_limit_error",
        "daily_request_limit",
        429
      );
    }

    if (
      effective.maxTokensPerDay !== null &&
      totalTokens >= effective.maxTokensPerDay
    ) {
      return makeProxyError(
        `Daily token limit exceeded: max ${effective.maxTokensPerDay} tokens per day`,
        "rate_limit_error",
        "daily_token_limit",
        429
      );
    }
  }

  return null;
}
