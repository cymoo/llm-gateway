import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
  notFoundResponse,
} from "@/app/api/admin/middleware";
import { generateApiKey } from "@/lib/utils/api-key";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const apiKey = generateApiKey();

  const [updated] = await db
    .update(users)
    .set({ apiKey, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();

  if (!updated) return notFoundResponse("User not found");
  return Response.json({ apiKey: updated.apiKey });
}
