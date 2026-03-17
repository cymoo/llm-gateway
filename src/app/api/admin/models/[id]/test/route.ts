import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { models } from "@/lib/db/schema";
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
  const rows = await db.select().from(models).where(eq(models.id, id)).limit(1);
  if (rows.length === 0) return notFoundResponse("Model not found");

  const model = rows[0];
  const testUrl = `${model.backendUrl.replace(/\/$/, "")}/models`;

  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const headers: Record<string, string> = {};
    if (model.backendApiKey) {
      headers["Authorization"] = `Bearer ${model.backendApiKey}`;
    }

    const res = await fetch(testUrl, { signal: controller.signal, headers });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    if (res.ok) {
      return Response.json({ status: "ok", latency_ms: latencyMs });
    } else {
      return Response.json({
        status: "error",
        message: `Backend returned ${res.status} ${res.statusText}`,
      });
    }
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Connection timeout"
          : err.message
        : "Unknown error";
    return Response.json({ status: "error", message });
  }
}
