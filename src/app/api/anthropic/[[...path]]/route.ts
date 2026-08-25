import { NextRequest } from "next/server";
import { handleAnthropicProxy } from "@/lib/proxy/anthropic-handler";
import { makeAnthropicError } from "@/lib/proxy/anthropic-errors";
import { getAuthorizedModelCatalog } from "@/lib/models/catalog";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params;
  const remainingPath = path?.length ? path.join("/") : "v1/messages";
  return handleAnthropicProxy(req, remainingPath);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params;
  const remainingPath = path?.join("/") ?? "";
  if (remainingPath !== "v1/models" && remainingPath !== "models") {
    return makeAnthropicError(
      "Use GET /api/anthropic/v1/models or POST /api/anthropic/v1/messages",
      "not_found_error",
      405
    );
  }

  const xApiKey = req.headers.get("x-api-key")?.trim();
  const authHeader = req.headers.get("authorization");
  const bearerKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const apiKey = xApiKey || bearerKey;
  if (!apiKey) {
    return makeAnthropicError(
      "Missing API key (use x-api-key header)",
      "authentication_error",
      401
    );
  }

  const catalog = await getAuthorizedModelCatalog(apiKey);
  if (!catalog) {
    return makeAnthropicError("Invalid API key", "authentication_error", 401);
  }

  const rawLimit = req.nextUrl.searchParams.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return makeAnthropicError(
      "limit must be an integer between 1 and 1000",
      "invalid_request_error",
      400
    );
  }

  const afterId = req.nextUrl.searchParams.get("after_id");
  const beforeId = req.nextUrl.searchParams.get("before_id");
  if (afterId && beforeId) {
    return makeAnthropicError(
      "after_id and before_id cannot be used together",
      "invalid_request_error",
      400
    );
  }

  // The Anthropic-compatible surface currently serves Messages only; do not
  // advertise embedding/rerank aliases that cannot be used with that API.
  const models = catalog
    .filter((model) => model.type === "chat")
    .slice()
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.alias.localeCompare(b.alias)
    );

  let candidates = models;
  let pageFromEnd = false;
  const cursor = afterId || beforeId;
  if (cursor) {
    const cursorIndex = models.findIndex((model) => model.alias === cursor);
    if (cursorIndex === -1) {
      return makeAnthropicError(
        `Unknown model cursor '${cursor}'`,
        "invalid_request_error",
        400
      );
    }
    if (afterId) candidates = models.slice(cursorIndex + 1);
    else {
      candidates = models.slice(0, cursorIndex);
      pageFromEnd = true;
    }
  }

  const pageModels = pageFromEnd
    ? candidates.slice(Math.max(0, candidates.length - limit))
    : candidates.slice(0, limit);
  const hasMore = candidates.length > pageModels.length;
  const data = pageModels.map((model) => ({
    id: model.alias,
    type: "model" as const,
    display_name: model.alias,
    created_at: model.createdAt.toISOString(),
    max_input_tokens: model.maxModelLen ?? null,
    max_tokens: null,
    capabilities: null,
  }));

  return Response.json({
    data,
    has_more: hasMore,
    first_id: data[0]?.id ?? null,
    last_id: data[data.length - 1]?.id ?? null,
  });
}
