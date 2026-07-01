import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
  notFoundResponse,
} from "@/app/api/admin/middleware";
import { recordAudit } from "@/lib/audit/recorder";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;

  const [updated] = await db
    .update(users)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();

  if (!updated) return notFoundResponse("User not found");

  recordAudit({
    adminId: admin.userId,
    adminEmail: admin.email,
    action: "user.approve",
    resourceType: "user",
    resourceId: updated.id,
    resourceLabel: updated.email,
    changes: { after: { isActive: true } },
    req,
  });

  return Response.json({ success: true });
}
