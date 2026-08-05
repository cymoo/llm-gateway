import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { models, modelBackends, type ModelBackend } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import {
  getAdminUser,
  unauthorizedResponse,
  notFoundResponse,
} from "@/app/api/admin/middleware";

type Params = { params: Promise<{ id: string }> };

const TEST_TIMEOUT_MS = parseInt(process.env.MODEL_TEST_TIMEOUT_MS || "15000");

interface BackendTestResult {
  backendId: string;
  backendUrl: string;
  status: "ok" | "error";
  latency_ms?: number;
  message?: string;
}

// Exercise a backend through the same endpoint the proxy forwards to, with a
// minimal payload, so the test validates the real request path — backend URL,
// backend model id, auth, and endpoint — not merely whether the host is
// reachable. A plain `GET /models` ping can't tell a working model from a
// wrong model id, and embedding-only backends (TEI, Infinity, etc.) often
// don't expose `/models` at all, so that ping 404s even when the model works.
async function testBackend(
  modelType: string,
  backend: ModelBackend
): Promise<BackendTestResult> {
  const base = backend.backendUrl.replace(/\/$/, "");

  let testUrl: string;
  let testBody: Record<string, unknown>;
  if (modelType === "embedding") {
    testUrl = `${base}/embeddings`;
    testBody = { model: backend.backendModel, input: "ping" };
  } else if (modelType === "rerank") {
    testUrl = `${base}/rerank`;
    testBody = {
      model: backend.backendModel,
      query: "ping",
      documents: ["ping"],
    };
  } else {
    testUrl = `${base}/chat/completions`;
    testBody = {
      model: backend.backendModel,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    };
  }

  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (backend.backendApiKey) {
      headers["Authorization"] = `Bearer ${backend.backendApiKey}`;
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
      return {
        backendId: backend.id,
        backendUrl: backend.backendUrl,
        status: "ok",
        latency_ms: latencyMs,
      };
    }

    // Surface a snippet of the backend error so a wrong model id / key / URL is
    // diagnosable straight from the toast, instead of a bare status code.
    const detail = (await res.text().catch(() => ""))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    return {
      backendId: backend.id,
      backendUrl: backend.backendUrl,
      status: "error",
      message: `Backend returned ${res.status}${
        res.statusText ? ` ${res.statusText}` : ""
      }${detail ? `: ${detail}` : ""}`,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? "Connection timeout"
          : err.message
        : "Unknown error";
    return {
      backendId: backend.id,
      backendUrl: backend.backendUrl,
      status: "error",
      message,
    };
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await getAdminUser(req);
  if (!admin) return unauthorizedResponse();

  const { id } = await params;
  const rows = await db.select().from(models).where(eq(models.id, id)).limit(1);
  if (rows.length === 0) return notFoundResponse("Model not found");
  const model = rows[0];

  // Optional body: { backendId } tests just that backend; otherwise all of the
  // model's backends (inactive included — admins verify before enabling).
  let backendIdFilter: string | undefined;
  try {
    const body = await req.json();
    if (body && typeof body.backendId === "string") {
      backendIdFilter = body.backendId;
    }
  } catch {
    // No/invalid body — test all backends.
  }

  let backends = await db
    .select()
    .from(modelBackends)
    .where(eq(modelBackends.modelId, id))
    .orderBy(asc(modelBackends.createdAt), asc(modelBackends.id));

  if (backendIdFilter !== undefined) {
    backends = backends.filter((b) => b.id === backendIdFilter);
    if (backends.length === 0) return notFoundResponse("Backend not found");
  }

  const results = await Promise.all(
    backends.map((b) => testBackend(model.type ?? "chat", b))
  );

  return Response.json({ results });
}
