import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
  notFoundResponse,
} from "@/app/api/admin/middleware";

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
  return Response.json({ success: true });
}
