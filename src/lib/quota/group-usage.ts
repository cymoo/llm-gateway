import { db } from "@/lib/db";
import { dailyUsage, users } from "@/lib/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

/** Aggregate today's usage of current members, including inactive members. */
export async function getGroupDailyUsage(
  groupId: string,
  date: string,
  modelIds: string[],
) {
  if (modelIds.length === 0) return [];
  return db
    .select({
      modelId: dailyUsage.modelId,
      totalTokens: sql`coalesce(sum(${dailyUsage.totalTokens}), 0)`.mapWith(Number),
      requestCount: sql`coalesce(sum(${dailyUsage.requestCount}), 0)`.mapWith(Number),
    })
    .from(dailyUsage)
    .innerJoin(users, eq(dailyUsage.userId, users.id))
    .where(
      and(
        eq(users.groupId, groupId),
        eq(dailyUsage.date, date),
        inArray(dailyUsage.modelId, modelIds),
      ),
    )
    .groupBy(dailyUsage.modelId);
}
