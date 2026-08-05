import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  users,
  groups,
  models,
  userModels,
  groupModels,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { makeProxyError, normalizeBackendError } from "./errors";
import { checkQuota } from "@/lib/quota/checker";
import { recordUsage } from "@/lib/usage/recorder";
import { createStreamTransformer } from "./stream";
import {
  affinityKey,
  forwardWithFailover,
  getActiveBackends,
  orderBackendsForRequest,
} from "./backends";

const PROXY_TIMEOUT_NON_STREAM = parseInt(
  process.env.PROXY_TIMEOUT_NON_STREAM || "300000",
);
const PROXY_TIMEOUT_STREAM = parseInt(
  process.env.PROXY_TIMEOUT_STREAM || "600000",
);

export type RequestType =
  "chat.completions" | "completions" | "embeddings" | "rerank";

// Model `type` required by each request endpoint. The endpoint and the model's
// declared type must match; rows without an explicit type default to "chat".
const REQUEST_TYPE_TO_MODEL_TYPE: Record<RequestType, string> = {
  "chat.completions": "chat",
  completions: "chat",
  embeddings: "embedding",
  rerank: "rerank",
};

// Upstream path segment appended to the model's backendUrl per request type.
const SUFFIX: Record<RequestType, string> = {
  "chat.completions": "chat/completions",
  completions: "completions",
  embeddings: "embeddings",
  rerank: "rerank",
};

// Request types that are always non-streaming: any client-sent streaming
// controls are ignored and stripped before forwarding upstream.
const NON_STREAMING_TYPES = new Set<RequestType>(["embeddings", "rerank"]);

export async function handleProxy(
  req: NextRequest,
  requestType: RequestType,
): Promise<Response> {
  const startTime = Date.now();

  // 1. Authenticate
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return makeProxyError(
      "Missing or invalid Authorization header",
      "authentication_error",
      "invalid_api_key",
      401,
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
      401,
    );
  }

  const user = userRows[0];
  if (!user.isActive) {
    return makeProxyError(
      "User account is disabled",
      "authentication_error",
      "user_disabled",
      403,
    );
  }

  // Fetch user's group (skip if no groupId to avoid unnecessary query)
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
    return makeProxyError(
      "Invalid JSON body",
      "server_error",
      "backend_unavailable",
      400,
    );
  }

  const modelAlias = body.model as string;
  if (!modelAlias) {
    return makeProxyError(
      "Missing model field in request body",
      "not_found_error",
      "model_not_found",
      400,
    );
  }

  // Extract prompt preview: embeddings send `input`, rerank sends `query`,
  // chat/completions send `messages`.
  let promptPreview: string | null = null;
  if (requestType === "embeddings") {
    const input = body.input;
    if (typeof input === "string") {
      promptPreview = input;
    } else if (Array.isArray(input) && typeof input[0] === "string") {
      promptPreview = input[0] as string;
    }
  } else if (requestType === "rerank") {
    const query = body.query;
    if (typeof query === "string") {
      promptPreview = query;
    }
  } else {
    const messages = body.messages as
      Array<{ role?: string; content?: string }> | undefined;
    if (Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const messageContent = messages[i].content;
        if (messages[i].role === "user" && typeof messageContent === "string") {
          promptPreview = messageContent;
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
    return makeProxyError(
      `Model '${modelAlias}' not found`,
      "not_found_error",
      "model_not_found",
      404,
    );
  }

  const model = modelRows[0];

  // Enforce endpoint <-> model type: each endpoint requires a model of the
  // matching type (embeddings -> "embedding", rerank -> "rerank", chat and
  // completions -> "chat"). Rows without an explicit type (legacy data / test
  // mocks) default to "chat".
  const expectedType = REQUEST_TYPE_TO_MODEL_TYPE[requestType];
  if ((model.type ?? "chat") !== expectedType) {
    return makeProxyError(
      `Model '${modelAlias}' does not support the ${SUFFIX[requestType]} endpoint`,
      "not_found_error",
      "model_type_mismatch",
      404,
    );
  }

  // 4. Authorize — group models take precedence; user's own models are also valid
  const isDefaultGroup = !group || group.isDefault;
  let authorized = false;
  let quotaSource: import("@/lib/quota/checker").QuotaSource = { type: "user" };

  if (isDefaultGroup) {
    const authRows = await db
      .select()
      .from(userModels)
      .where(
        and(eq(userModels.userId, user.id), eq(userModels.modelId, model.id)),
      )
      .limit(1);
    authorized = authRows.length > 0;
    quotaSource = { type: "user" };
  } else {
    // Check group first (higher priority)
    const groupAuthRows = await db
      .select()
      .from(groupModels)
      .where(
        and(
          eq(groupModels.groupId, group.id),
          eq(groupModels.modelId, model.id),
        ),
      )
      .limit(1);

    if (groupAuthRows.length > 0) {
      authorized = true;
      quotaSource = { type: "group", groupId: group.id };
    } else {
      // Fall back to user's own model list
      const userAuthRows = await db
        .select()
        .from(userModels)
        .where(
          and(eq(userModels.userId, user.id), eq(userModels.modelId, model.id)),
        )
        .limit(1);
      authorized = userAuthRows.length > 0;
      quotaSource = { type: "user" };
    }
  }

  if (!authorized) {
    return makeProxyError(
      `You are not authorized to use model '${modelAlias}'`,
      "permission_error",
      "model_not_allowed",
      403,
    );
  }

  // 5. Check quotas
  const quotaError = await checkQuota({
    userId: user.id,
    modelId: model.id,
    modelAlias: model.alias,
    quotaSource,
    defaultMaxTokensPerDay: model.defaultMaxTokensPerDay ?? null,
    defaultMaxRequestsPerDay: model.defaultMaxRequestsPerDay ?? null,
    defaultMaxRequestsPerMin: model.defaultMaxRequestsPerMin ?? null,
    defaultAllowedTimeStart: model.defaultAllowedTimeStart ?? null,
    defaultAllowedTimeEnd: model.defaultAllowedTimeEnd ?? null,
  });

  if (quotaError) return quotaError;

  // 6. Forward request
  // Embeddings and rerank are always non-streaming; ignore a spurious
  // `stream: true` so the response is proxied as JSON and token usage is
  // accounted correctly.
  const isStream =
    !NON_STREAMING_TYPES.has(requestType) && body.stream === true;
  const timeout = isStream ? PROXY_TIMEOUT_STREAM : PROXY_TIMEOUT_NON_STREAM;

  // Body minus the model field; each backend sets its own backend_model.
  const backendBodyBase: Record<string, unknown> = { ...body };
  if (NON_STREAMING_TYPES.has(requestType)) {
    // Non-streaming endpoints never forward streaming controls, even if the
    // client sent them, so the upstream doesn't reject the request.
    delete backendBodyBase.stream;
    delete backendBodyBase.stream_options;
  } else if (isStream) {
    // Inject stream_options.include_usage so the backend emits a final usage
    // chunk; otherwise streamed requests record 0 tokens.
    backendBodyBase.stream_options = {
      ...(body.stream_options as Record<string, unknown> | undefined),
      include_usage: true,
    };
  }

  const backends = orderBackendsForRequest(
    model.id,
    await getActiveBackends(model.id),
    affinityKey(requestType, body),
  );
  if (backends.length === 0) {
    return makeProxyError(
      `Model '${modelAlias}' has no active backends`,
      "server_error",
      "backend_unavailable",
      503,
    );
  }

  const outcome = await forwardWithFailover({
    backends,
    timeoutMs: timeout,
    buildRequest: (backend) => ({
      url: `${backend.backendUrl.replace(/\/$/, "")}/${SUFFIX[requestType]}`,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(backend.backendApiKey
            ? { Authorization: `Bearer ${backend.backendApiKey}` }
            : {}),
        },
        body: JSON.stringify({
          ...backendBodyBase,
          model: backend.backendModel,
        }),
      },
    }),
  });

  if (outcome.kind === "timeout") {
    return makeProxyError(
      "Request timed out",
      "server_error",
      "backend_timeout",
      504,
    );
  }
  if (outcome.kind === "network_error") {
    return makeProxyError(
      "Backend is unavailable",
      "server_error",
      "backend_unavailable",
      502,
    );
  }
  if (outcome.kind === "http_error") {
    const normalizedError = normalizeBackendError(outcome.text, outcome.status);
    if (normalizedError) {
      return normalizedError;
    }
    return new Response(outcome.text, {
      status: outcome.status,
      headers: {
        "Content-Type": outcome.contentType || "application/json",
      },
    });
  }

  const backendResponse = outcome.response;

  if (isStream) {
    // Stream response
    if (!backendResponse.body) {
      return makeProxyError(
        "Backend returned empty response",
        "server_error",
        "backend_unavailable",
        502,
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
        promptPreview,
        clientIp,
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
      promptPreview,
      clientIp,
    });

    return new Response(responseText, {
      status: backendResponse.status,
      headers: {
        "Content-Type":
          backendResponse.headers.get("content-type") || "application/json",
      },
    });
  }
}
