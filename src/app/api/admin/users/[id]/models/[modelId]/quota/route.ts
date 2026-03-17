import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { userModelQuotas } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
} from "@/app/api/admin/middleware";

type Params = { params: Promise<{ id: string; modelId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id, modelId } = await params;
  const body = await req.json();

  const quota = {
    userId: id,
    modelId,
    maxTokensPerDay: body.maxTokensPerDay ?? null,
    maxRequestsPerDay: body.maxRequestsPerDay ?? null,
    maxRequestsPerMin: body.maxRequestsPerMin ?? null,
    allowedTimeStart: body.allowedTimeStart ?? null,
    allowedTimeEnd: body.allowedTimeEnd ?? null,
    updatedAt: new Date(),
  };

  const [result] = await db
    .insert(userModelQuotas)
    .values(quota)
    .onConflictDoUpdate({
      target: [userModelQuotas.userId, userModelQuotas.modelId],
      set: {
        maxTokensPerDay: quota.maxTokensPerDay,
        maxRequestsPerDay: quota.maxRequestsPerDay,
        maxRequestsPerMin: quota.maxRequestsPerMin,
        allowedTimeStart: quota.allowedTimeStart,
        allowedTimeEnd: quota.allowedTimeEnd,
        updatedAt: quota.updatedAt,
      },
    })
    .returning();

  return Response.json(result);
}
