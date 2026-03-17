import { db } from "@/lib/db";
import { userModelQuotas, models, dailyUsage } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getRateLimiter } from "./rate-limiter";
import { makeProxyError } from "@/lib/proxy/errors";

export interface QuotaContext {
  userId: string;
  modelId: string;
  modelAlias: string;
  defaultMaxTokensPerDay: number | null;
  defaultMaxRequestsPerDay: number | null;
  defaultMaxRequestsPerMin: number | null;
  defaultAllowedTimeStart: string | null;
  defaultAllowedTimeEnd: string | null;
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

export async function checkQuota(
  ctx: QuotaContext
): Promise<Response | null> {
  const { userId, modelId } = ctx;

  // Get user-specific quota (if exists)
  const quotaRows = await db
    .select()
    .from(userModelQuotas)
    .where(
      and(
        eq(userModelQuotas.userId, userId),
        eq(userModelQuotas.modelId, modelId)
      )
    )
    .limit(1);

  const quota = quotaRows[0];

  // Resolve effective quota values (user-specific overrides model defaults)
  const maxTokensPerDay =
    quota?.maxTokensPerDay ?? ctx.defaultMaxTokensPerDay ?? null;
  const maxRequestsPerDay =
    quota?.maxRequestsPerDay ?? ctx.defaultMaxRequestsPerDay ?? null;
  const maxRequestsPerMin =
    quota?.maxRequestsPerMin ?? ctx.defaultMaxRequestsPerMin ?? null;
  const allowedTimeStart =
    quota?.allowedTimeStart ?? ctx.defaultAllowedTimeStart ?? null;
  const allowedTimeEnd =
    quota?.allowedTimeEnd ?? ctx.defaultAllowedTimeEnd ?? null;

  // 1. Check time window
  if (allowedTimeStart && allowedTimeEnd) {
    const currentSec = timeToSeconds(getCurrentTimeStr());
    const startSec = timeToSeconds(allowedTimeStart);
    const endSec = timeToSeconds(allowedTimeEnd);

    let allowed: boolean;
    if (startSec <= endSec) {
      allowed = currentSec >= startSec && currentSec <= endSec;
    } else {
      // Crosses midnight
      allowed = currentSec >= startSec || currentSec <= endSec;
    }

    if (!allowed) {
      return makeProxyError(
        `Access is only allowed between ${allowedTimeStart} and ${allowedTimeEnd}`,
        "permission_error",
        "time_restricted",
        403
      );
    }
  }

  // 2. Check per-minute rate limit (in-memory)
  if (maxRequestsPerMin !== null) {
    const limiter = getRateLimiter();
    if (!limiter.check(userId, modelId, maxRequestsPerMin)) {
      return makeProxyError(
        `Rate limit exceeded: max ${maxRequestsPerMin} requests per minute`,
        "rate_limit_error",
        "rate_limit_exceeded",
        429
      );
    }
  }

  // 3. Check daily quotas from database
  if (maxRequestsPerDay !== null || maxTokensPerDay !== null) {
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
    const currentRequests = usage?.requestCount ?? 0;
    const currentTokens = usage?.totalTokens ?? 0;

    if (maxRequestsPerDay !== null && currentRequests >= maxRequestsPerDay) {
      return makeProxyError(
        `Daily request limit exceeded: max ${maxRequestsPerDay} requests per day`,
        "rate_limit_error",
        "daily_request_limit",
        429
      );
    }

    if (maxTokensPerDay !== null && currentTokens >= maxTokensPerDay) {
      return makeProxyError(
        `Daily token limit exceeded: max ${maxTokensPerDay} tokens per day`,
        "rate_limit_error",
        "daily_token_limit",
        429
      );
    }
  }

  return null;
}
