import { db } from "@/lib/db";
import { usageLogs, dailyUsage } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export interface UsageRecord {
  userId: string;
  modelId: string;
  requestType: "chat.completions" | "completions";
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  isStream: boolean;
  durationMs: number;
  status: "success" | "error";
}

function getTodayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const d = now.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function recordUsage(record: UsageRecord): void {
  // Non-blocking async record
  setImmediate(async () => {
    try {
      const today = getTodayStr();

      await db.insert(usageLogs).values({
        userId: record.userId,
        modelId: record.modelId,
        requestType: record.requestType,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        totalTokens: record.totalTokens,
        isStream: record.isStream,
        durationMs: record.durationMs,
        status: record.status,
      });

      // Upsert daily usage
      await db
        .insert(dailyUsage)
        .values({
          userId: record.userId,
          modelId: record.modelId,
          date: today,
          totalTokens: record.totalTokens,
          requestCount: 1,
        })
        .onConflictDoUpdate({
          target: [dailyUsage.userId, dailyUsage.modelId, dailyUsage.date],
          set: {
            totalTokens: sql`${dailyUsage.totalTokens} + ${record.totalTokens}`,
            requestCount: sql`${dailyUsage.requestCount} + 1`,
          },
        });
    } catch (err) {
      console.error("[usage] Failed to record usage:", err);
    }
  });
}
