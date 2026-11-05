import { db } from "@/lib/db";
import { userModelQuotas, groupModelQuotas, dailyUsage } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getRateLimiter, type RateLimit } from "./rate-limiter";
import { getGroupDailyUsage } from "./group-usage";
import { getTodayStr } from "@/lib/usage/date";
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

export interface NumericQuota {
  maxTokensPerDay: number | null;
  maxRequestsPerDay: number | null;
  maxRequestsPerMin: number | null;
}

export interface EffectiveQuota extends NumericQuota {
  groupQuota: NumericQuota | null;
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

function personalNumber(
  key: NumericQuotaKey,
  access: QuotaAccess,
  defaults: QuotaValues,
  userQuota?: QuotaValues,
  groupQuota?: QuotaValues,
): number | null {
  if (access.viaUser && userQuota?.[key] != null) return userQuota[key];
  // A configured shared budget replaces the model fallback for this field,
  // but never replaces an explicitly configured personal budget.
  if (access.groupId && groupQuota?.[key] != null) return null;
  return defaults[key];
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
 * Numeric fields describe the personal budget; groupQuota describes the
 * separate shared budget. Both must pass using their own usage counters.
 * Model defaults apply only when neither source configures a field. Every
 * returned time window must be satisfied, including across midnight.
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
    maxTokensPerDay: personalNumber(
      "maxTokensPerDay",
      access,
      defaults,
      userQuota,
      groupQuota,
    ),
    maxRequestsPerDay: personalNumber(
      "maxRequestsPerDay",
      access,
      defaults,
      userQuota,
      groupQuota,
    ),
    maxRequestsPerMin: personalNumber(
      "maxRequestsPerMin",
      access,
      defaults,
      userQuota,
      groupQuota,
    ),
    groupQuota: access.groupId
      ? {
          maxTokensPerDay: groupQuota?.maxTokensPerDay ?? null,
          maxRequestsPerDay: groupQuota?.maxRequestsPerDay ?? null,
          maxRequestsPerMin: groupQuota?.maxRequestsPerMin ?? null,
        }
      : null,
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
  const isTimeAllowed = effective.allowedTimeWindows.every((window) =>
    isWithinAllowedWindow(currentTime, window),
  );
  if (!isTimeAllowed) {
    const [onlyWindow] = effective.allowedTimeWindows;
    const windows = effective.allowedTimeWindows
      .map((window) => `${window.start}–${window.end}`)
      .join(" ∩ ");
    return makeProxyError(
      effective.allowedTimeWindows.length === 1
        ? `Access is only allowed between ${onlyWindow.start} and ${onlyWindow.end}`
        : `Access is only allowed during all configured time windows: ${windows}`,
      "permission_error",
      "time_restricted",
      403
    );
  }

  const today = getTodayStr();
  if (
    effective.maxRequestsPerDay !== null ||
    effective.maxTokensPerDay !== null
  ) {
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

  const shared = effective.groupQuota;
  if (
    ctx.access.groupId && shared &&
    (shared.maxRequestsPerDay !== null || shared.maxTokensPerDay !== null)
  ) {
    const [usage] = await getGroupDailyUsage(ctx.access.groupId, today, [modelId]);
    if (
      shared.maxRequestsPerDay !== null &&
      (usage?.requestCount ?? 0) >= shared.maxRequestsPerDay
    ) {
      return makeProxyError(
        `Group daily request limit exceeded: max ${shared.maxRequestsPerDay} requests per day shared by all members`,
        "rate_limit_error", "daily_request_limit", 429,
      );
    }
    if (
      shared.maxTokensPerDay !== null &&
      (usage?.totalTokens ?? 0) >= shared.maxTokensPerDay
    ) {
      return makeProxyError(
        `Group daily token limit exceeded: max ${shared.maxTokensPerDay} tokens per day shared by all members`,
        "rate_limit_error", "daily_token_limit", 429,
      );
    }
  }

  const limits: RateLimit[] = [];
  if (effective.maxRequestsPerMin !== null) {
    limits.push({
      subjectId: userId, modelId, maxPerMin: effective.maxRequestsPerMin,
    });
  }
  if (ctx.access.groupId && shared?.maxRequestsPerMin != null) {
    limits.push({
      subjectId: `group:${ctx.access.groupId}`, modelId, maxPerMin: shared.maxRequestsPerMin,
    });
  }
  // Check all scopes before consuming any RPM budget, so a rejection in one
  // scope cannot exhaust another member's shared budget.
  if (limits.length > 0) {
    const rejected = getRateLimiter().checkAll(limits);
    if (rejected) {
      return makeProxyError(
        `${rejected.subjectId.startsWith("group:") ? "Group rate" : "Rate"} limit exceeded: max ${rejected.maxPerMin} requests per minute`,
        "rate_limit_error", "rate_limit_exceeded", 429,
      );
    }
  }

  return null;
}
