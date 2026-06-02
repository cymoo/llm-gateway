import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, groups, models, userModels, groupModels } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { makeAnthropicError, normalizeAnthropicBackendError } from "./anthropic-errors";
import { checkQuota } from "@/lib/quota/checker";
import { recordUsage, UsageRecord } from "@/lib/usage/recorder";

const PROXY_TIMEOUT_NON_STREAM = parseInt(
  process.env.PROXY_TIMEOUT_NON_STREAM || "300000"
);
const PROXY_TIMEOUT_STREAM = parseInt(
  process.env.PROXY_TIMEOUT_STREAM || "600000"
);

export async function handleAnthropicProxy(
  req: NextRequest,
  remainingPath: string
): Promise<Response> {
  // 1. Authenticate — Anthropic SDK uses x-api-key header
  let apiKey = req.headers.get("x-api-key")?.trim();
  if (!apiKey) {
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      apiKey = authHeader.slice(7).trim();
    }
  }
  if (!apiKey) {
    return makeAnthropicError(
      "Missing API key (use x-api-key header)",
      "authentication_error",
      401
    );
  }

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.apiKey, apiKey))
    .limit(1);

  if (userRows.length === 0) {
    return makeAnthropicError(
      "Invalid API key",
      "authentication_error",
      401
    );
  }

  const user = userRows[0];
  if (!user.isActive) {
    return makeAnthropicError(
      "User account is disabled",
      "permission_error",
      403
    );
  }

  // ── Full pipeline with model resolution ───────────────────────────

  const startTime = Date.now();

  const group = user.groupId
    ? (
        await db
          .select()
          .from(groups)
          .where(eq(groups.id, user.groupId))
          .limit(1)
      )[0]
    : undefined;

  // 2. Parse request body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return makeAnthropicError(
      "Invalid JSON body",
      "server_error",
      400
    );
  }

  const modelAlias = body.model as string;
  if (!modelAlias) {
    return makeAnthropicError(
      "Missing model field in request body",
      "not_found_error",
      400
    );
  }

  // Extract prompt preview from messages (Anthropic format)
  let promptPreview: string | null = null;
  const messages = body.messages as Array<{
    role?: string;
    content?: string | Array<{ type?: string; text?: string }>;
  }> | undefined;
  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user") {
        if (typeof msg.content === "string") {
          promptPreview = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "text" && block.text) {
              promptPreview = block.text;
              break;
            }
          }
        }
        if (promptPreview) break;
      }
    }
  }

  // Also check the system prompt (Anthropic top-level "system" field)
  if (!promptPreview) {
    const system = body.system;
    if (typeof system === "string") {
      promptPreview = system;
    } else if (Array.isArray(system)) {
      for (const block of system) {
        if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
          promptPreview = block.text;
          break;
        }
      }
    }
  }

  // Extract client IP
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;

  // 3. Resolve model
  const modelRows = await db
    .select()
    .from(models)
    .where(and(eq(models.alias, modelAlias), eq(models.isActive, true)))
    .limit(1);

  if (modelRows.length === 0) {
    return makeAnthropicError(
      `Model '${modelAlias}' not found`,
      "not_found_error",
      404
    );
  }

  const model = modelRows[0];

  // 4. Authorize
  const isDefaultGroup = !group || group.isDefault;
  let authorized = false;

  if (isDefaultGroup) {
    const authRows = await db
      .select()
      .from(userModels)
      .where(
        and(eq(userModels.userId, user.id), eq(userModels.modelId, model.id))
      )
      .limit(1);
    authorized = authRows.length > 0;
  } else {
    const authRows = await db
      .select()
      .from(groupModels)
      .where(
        and(
          eq(groupModels.groupId, group.id),
          eq(groupModels.modelId, model.id)
        )
      )
      .limit(1);
    authorized = authRows.length > 0;
  }

  if (!authorized) {
    return makeAnthropicError(
      `You are not authorized to use model '${modelAlias}'`,
      "permission_error",
      403
    );
  }

  // 5. Check quotas
  const quotaError = await checkQuota({
    userId: user.id,
    modelId: model.id,
    modelAlias: model.alias,
    quotaSource: isDefaultGroup
      ? { type: "user" }
      : { type: "group", groupId: group.id },
    defaultMaxTokensPerDay: model.defaultMaxTokensPerDay ?? null,
    defaultMaxRequestsPerDay: model.defaultMaxRequestsPerDay ?? null,
    defaultMaxRequestsPerMin: model.defaultMaxRequestsPerMin ?? null,
    defaultAllowedTimeStart: model.defaultAllowedTimeStart ?? null,
    defaultAllowedTimeEnd: model.defaultAllowedTimeEnd ?? null,
  });

  if (quotaError) {
    // Convert OpenAI-format quota errors to Anthropic format
    let errorText = "";
    try {
      const errJson = await quotaError.json();
      errorText = errJson?.error?.message || "";
    } catch { /* ignore */ }

    const status = quotaError.status;
    if (status === 429) {
      return makeAnthropicError(
        errorText || "Rate limit exceeded",
        "rate_limit_error",
        429
      );
    }
    if (status === 403) {
      return makeAnthropicError(
        errorText || "Access restricted",
        "permission_error",
        403
      );
    }
    return quotaError;
  }

  // 6. Forward request
  const isStream = body.stream === true;
  const timeout = isStream ? PROXY_TIMEOUT_STREAM : PROXY_TIMEOUT_NON_STREAM;

  // Rewrite model field to backend_model
  const backendBody = { ...body, model: model.backendModel };

  let backendUrlBase = model.backendUrl.replace(/\/$/, "");
  // Avoid double /v1: if backend already ends with /v1 and path starts with v1/,
  // strip /v1 from backend so we don't get /v1/v1/messages
  if (backendUrlBase.endsWith("/v1") && remainingPath.startsWith("v1/")) {
    backendUrlBase = backendUrlBase.replace(/\/v1$/, "");
  }
  const backendUrl = `${backendUrlBase}/${remainingPath}`;

  console.log("[anthropic-proxy] forwarding to:", backendUrl, "model:", model.backendModel);

  const headers = buildForwardHeaders(apiKey, model.backendApiKey ?? undefined);
  forwardAnthropicHeaders(req, headers);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const backendResponse = await fetch(backendUrl, {
      method: req.method,
      headers,
      body: JSON.stringify(backendBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!backendResponse.ok) {
      const backendErrorText = await backendResponse.text();
      const normalizedError = normalizeAnthropicBackendError(
        backendErrorText,
        backendResponse.status
      );
      if (normalizedError) {
        return normalizedError;
      }

      return new Response(backendErrorText, {
        status: backendResponse.status,
        headers: {
          "Content-Type":
            backendResponse.headers.get("content-type") || "application/json",
        },
      });
    }

    if (isStream) {
      if (!backendResponse.body) {
        return makeAnthropicError(
          "Backend returned empty response",
          "server_error",
          502
        );
      }

      let streamUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      const transformer = createAnthropicStreamTransformer((usage) => {
        streamUsage = usage;
        const durationMs = Date.now() - startTime;
        recordUsage({
          userId: user.id,
          modelId: model.id,
          requestType: "chat.completions",
          ...usage,
          isStream: true,
          durationMs,
          status: "success",
          promptPreview,
          clientIp,
        } as UsageRecord);
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
            promptTokens: json.usage.input_tokens || 0,
            completionTokens: json.usage.output_tokens || 0,
            totalTokens:
              (json.usage.input_tokens || 0) +
              (json.usage.output_tokens || 0),
          };
        }
      } catch {
        // Ignore parse errors
      }

      recordUsage({
        userId: user.id,
        modelId: model.id,
        requestType: "chat.completions",
        ...usage,
        isStream: false,
        durationMs,
        status: "success",
        promptPreview,
        clientIp,
      } as UsageRecord);

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
      return makeAnthropicError(
        "Request timed out",
        "server_error",
        504
      );
    }

    console.error("[anthropic-proxy] Backend error:", err);
    return makeAnthropicError(
      "Backend is unavailable",
      "server_error",
      502
    );
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function buildForwardHeaders(
  apiKey: string,
  backendApiKey?: string
): Record<string, string> {
  const key = backendApiKey ?? apiKey;
  return {
    "Content-Type": "application/json",
    "x-api-key": key,
    Authorization: `Bearer ${key}`,
  };
}

function forwardAnthropicHeaders(
  req: NextRequest,
  headers: Record<string, string>
): void {
  const anthropicVersion = req.headers.get("anthropic-version");
  if (anthropicVersion) {
    headers["anthropic-version"] = anthropicVersion;
  }
  const anthropicBeta = req.headers.get("anthropic-beta");
  if (anthropicBeta) {
    headers["anthropic-beta"] = anthropicBeta;
  }
}

// ── Anthropic SSE stream transformer ────────────────────────────────

interface StreamUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Parses Anthropic-format SSE events to extract usage from
 * message_start (input_tokens) and message_delta (output_tokens).
 * Also handles OpenAI-format SSE chunks for compatibility.
 */
function createAnthropicStreamTransformer(
  onComplete: (usage: StreamUsage) => void
): TransformStream<Uint8Array, Uint8Array> {
  let buffer = "";
  let lastUsage: StreamUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  function processLine(line: string): void {
    if (!line.startsWith("data: ")) return;

    const data = line.slice(6).trim();
    if (data === "[DONE]") return;

    try {
      const parsed = JSON.parse(data);

      // Anthropic message_start: contains usage.input_tokens
      if (parsed.type === "message_start" && parsed.message?.usage) {
        lastUsage.promptTokens = parsed.message.usage.input_tokens || 0;
        lastUsage.totalTokens = lastUsage.promptTokens + lastUsage.completionTokens;
      }

      // Anthropic message_delta: contains usage.output_tokens
      if (parsed.type === "message_delta" && parsed.usage) {
        lastUsage.completionTokens = parsed.usage.output_tokens || 0;
        lastUsage.totalTokens = lastUsage.promptTokens + lastUsage.completionTokens;
      }

      // OpenAI-format usage (for vllm compatibility)
      if (parsed.usage) {
        if (parsed.usage.prompt_tokens) {
          lastUsage.promptTokens = parsed.usage.prompt_tokens;
        }
        if (parsed.usage.completion_tokens) {
          lastUsage.completionTokens = parsed.usage.completion_tokens;
        }
        if (parsed.usage.total_tokens) {
          lastUsage.totalTokens = parsed.usage.total_tokens;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      const text = new TextDecoder().decode(chunk);
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        processLine(line);
      }
    },
    flush() {
      if (buffer) {
        for (const line of buffer.split("\n")) {
          processLine(line);
        }
      }
      onComplete(lastUsage);
    },
  });
}
