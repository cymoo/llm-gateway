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

const TEST_TIMEOUT_MS = parseInt(process.env.MODEL_TEST_TIMEOUT_MS || "15000");

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const rows = await db.select().from(models).where(eq(models.id, id)).limit(1);
  if (rows.length === 0) return notFoundResponse("Model not found");

  const model = rows[0];

  // Exercise the model through the same endpoint the proxy forwards to, with a
  // minimal payload, so the test validates the real request path — backend URL,
  // backend model id, auth, and endpoint — not merely whether the host is
  // reachable. A plain `GET /models` ping can't tell a working model from a
  // wrong model id, and embedding-only backends (TEI, Infinity, etc.) often
  // don't expose `/models` at all, so that ping 404s even when the model works.
  const isEmbedding = (model.type ?? "chat") === "embedding";
  const base = model.backendUrl.replace(/\/$/, "");
  const testUrl = `${base}/${isEmbedding ? "embeddings" : "chat/completions"}`;
  const testBody = isEmbedding
    ? { model: model.backendModel, input: "ping" }
    : {
        model: model.backendModel,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      };

  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (model.backendApiKey) {
      headers["Authorization"] = `Bearer ${model.backendApiKey}`;
    }

    const res = await fetch(testUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(testBody),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    if (res.ok) {
      return Response.json({ status: "ok", latency_ms: latencyMs });
    }

    // Surface a snippet of the backend error so a wrong model id / key / URL is
    // diagnosable straight from the toast, instead of a bare status code.
    const detail = (await res.text().catch(() => ""))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    return Response.json({
      status: "error",
      message: `Backend returned ${res.status}${
        res.statusText ? ` ${res.statusText}` : ""
      }${detail ? `: ${detail}` : ""}`,
    });
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
