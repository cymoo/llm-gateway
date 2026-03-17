import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { models } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
  notFoundResponse,
} from "@/app/api/admin/middleware";
import { validateModelAlias, validateUrl } from "@/lib/utils/validators";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const rows = await db.select().from(models).where(eq(models.id, id)).limit(1);
  if (rows.length === 0) return notFoundResponse("Model not found");
  return Response.json(rows[0]);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const body = await req.json();

  if (body.alias && !validateModelAlias(body.alias)) {
    return Response.json({ error: "Invalid model alias format" }, { status: 400 });
  }

  if (body.backendUrl && !validateUrl(body.backendUrl)) {
    return Response.json({ error: "Invalid backendUrl" }, { status: 400 });
  }

  const updates: Partial<typeof models.$inferInsert> = {};
  const fields = [
    "alias",
    "backendUrl",
    "backendModel",
    "backendApiKey",
    "isActive",
    "defaultMaxTokensPerDay",
    "defaultMaxRequestsPerDay",
    "defaultMaxRequestsPerMin",
    "defaultAllowedTimeStart",
    "defaultAllowedTimeEnd",
  ] as const;

  for (const field of fields) {
    if (body[field] !== undefined) {
      (updates as Record<string, unknown>)[field] = body[field];
    }
  }

  try {
    const [updated] = await db
      .update(models)
      .set(updates)
      .where(eq(models.id, id))
      .returning();

    if (!updated) return notFoundResponse("Model not found");
    return Response.json(updated);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      return Response.json({ error: "Model alias already exists" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const [deleted] = await db
    .delete(models)
    .where(eq(models.id, id))
    .returning();

  if (!deleted) return notFoundResponse("Model not found");
  return Response.json({ success: true });
}
