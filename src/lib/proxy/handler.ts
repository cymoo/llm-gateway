import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, models, userModels } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { makeProxyError } from "./errors";
import { checkQuota } from "@/lib/quota/checker";
import { recordUsage } from "@/lib/usage/recorder";
import { createStreamTransformer } from "./stream";

const PROXY_TIMEOUT_NON_STREAM = parseInt(
  process.env.PROXY_TIMEOUT_NON_STREAM || "300000"
);
const PROXY_TIMEOUT_STREAM = parseInt(
  process.env.PROXY_TIMEOUT_STREAM || "600000"
);

export type RequestType = "chat.completions" | "completions";

export async function handleProxy(
  req: NextRequest,
  requestType: RequestType
): Promise<Response> {
  const startTime = Date.now();

  // 1. Authenticate
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return makeProxyError(
      "Missing or invalid Authorization header",
      "authentication_error",
      "invalid_api_key",
      401
    );
  }
  const apiKey = authHeader.slice(7).trim();

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.apiKey, apiKey))
    .limit(1);

  if (userRows.length === 0) {
    return makeProxyError(
      "Invalid API key",
      "authentication_error",
      "invalid_api_key",
      401
    );
  }

  const user = userRows[0];
  if (!user.isActive) {
    return makeProxyError(
      "User account is disabled",
      "authentication_error",
      "user_disabled",
      403
    );
  }

  // 2. Parse request body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return makeProxyError(
      "Invalid JSON body",
      "server_error",
      "backend_unavailable",
      400
    );
  }

  const modelAlias = body.model as string;
  if (!modelAlias) {
    return makeProxyError(
      "Missing model field in request body",
      "not_found_error",
      "model_not_found",
      400
    );
  }

  // 3. Resolve model
  const modelRows = await db
    .select()
    .from(models)
    .where(and(eq(models.alias, modelAlias), eq(models.isActive, true)))
    .limit(1);

  if (modelRows.length === 0) {
    return makeProxyError(
      `Model '${modelAlias}' not found`,
      "not_found_error",
      "model_not_found",
      404
    );
  }

  const model = modelRows[0];

  // 4. Authorize
  const authRows = await db
    .select()
    .from(userModels)
    .where(
      and(eq(userModels.userId, user.id), eq(userModels.modelId, model.id))
    )
    .limit(1);

  if (authRows.length === 0) {
    return makeProxyError(
      `You are not authorized to use model '${modelAlias}'`,
      "permission_error",
      "model_not_allowed",
      403
    );
  }

  // 5. Check quotas
  const quotaError = await checkQuota({
    userId: user.id,
    modelId: model.id,
    modelAlias: model.alias,
    defaultMaxTokensPerDay: model.defaultMaxTokensPerDay ?? null,
    defaultMaxRequestsPerDay: model.defaultMaxRequestsPerDay ?? null,
    defaultMaxRequestsPerMin: model.defaultMaxRequestsPerMin ?? null,
    defaultAllowedTimeStart: model.defaultAllowedTimeStart ?? null,
    defaultAllowedTimeEnd: model.defaultAllowedTimeEnd ?? null,
  });

  if (quotaError) return quotaError;

  // 6. Forward request
  const isStream = body.stream === true;
  const timeout = isStream ? PROXY_TIMEOUT_STREAM : PROXY_TIMEOUT_NON_STREAM;

  // Rewrite model field to backend_model
  const backendBody = { ...body, model: model.backendModel };

  const backendUrl = `${model.backendUrl.replace(/\/$/, "")}/${
    requestType === "chat.completions" ? "chat/completions" : "completions"
  }`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (model.backendApiKey) {
    headers["Authorization"] = `Bearer ${model.backendApiKey}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const backendResponse = await fetch(backendUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(backendBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (isStream) {
      // Stream response
      if (!backendResponse.body) {
        return makeProxyError(
          "Backend returned empty response",
          "server_error",
          "backend_unavailable",
          502
        );
      }

      let streamUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      const transformer = createStreamTransformer((usage) => {
        streamUsage = usage;
        const durationMs = Date.now() - startTime;
        recordUsage({
          userId: user.id,
          modelId: model.id,
          requestType,
          ...usage,
          isStream: true,
          durationMs,
          status: backendResponse.ok ? "success" : "error",
        });
      });

      const transformedStream = backendResponse.body.pipeThrough(transformer);

      return new Response(transformedStream, {
        status: backendResponse.status,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      // Non-streaming response
      const responseText = await backendResponse.text();
      const durationMs = Date.now() - startTime;

      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      try {
        const json = JSON.parse(responseText);
        if (json.usage) {
          usage = {
            promptTokens: json.usage.prompt_tokens || 0,
            completionTokens: json.usage.completion_tokens || 0,
            totalTokens: json.usage.total_tokens || 0,
          };
        }
      } catch {
        // Ignore parse errors
      }

      recordUsage({
        userId: user.id,
        modelId: model.id,
        requestType,
        ...usage,
        isStream: false,
        durationMs,
        status: backendResponse.ok ? "success" : "error",
      });

      return new Response(responseText, {
        status: backendResponse.status,
        headers: {
          "Content-Type":
            backendResponse.headers.get("content-type") || "application/json",
        },
      });
    }
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    if (err instanceof Error && err.name === "AbortError") {
      return makeProxyError(
        "Request timed out",
        "server_error",
        "backend_timeout",
        504
      );
    }

    console.error("[proxy] Backend error:", err);
    return makeProxyError(
      "Backend is unavailable",
      "server_error",
      "backend_unavailable",
      502
    );
  }
}
