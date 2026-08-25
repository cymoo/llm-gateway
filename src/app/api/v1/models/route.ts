import { NextRequest } from "next/server";
import { makeProxyError } from "@/lib/proxy/errors";
import { getAuthorizedModelCatalog } from "@/lib/models/catalog";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return makeProxyError(
      "Invalid API key",
      "authentication_error",
      "invalid_api_key",
      401
    );
  }

  const catalog = await getAuthorizedModelCatalog(authHeader.slice(7).trim());
  if (!catalog) {
    return makeProxyError(
      "Invalid API key",
      "authentication_error",
      "invalid_api_key",
      401
    );
  }

  const data = catalog.map((model) => ({
    id: model.alias,
    object: "model",
    created: Math.floor(model.createdAt.getTime() / 1000),
    owned_by: "llm-gateway",
    type: model.type,
    ...(model.maxModelLen !== undefined
      ? { max_model_len: model.maxModelLen }
      : {}),
  }));

  return Response.json({ object: "list", data });
}
