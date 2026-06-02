import { NextRequest } from "next/server";
import { handleAnthropicProxy } from "@/lib/proxy/anthropic-handler";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const remainingPath = path?.length ? path.join("/") : "v1/messages";
  return handleAnthropicProxy(req, remainingPath);
}

export async function GET() {
  return new Response(
    JSON.stringify({
      type: "error",
      error: { type: "not_found_error", message: "Use POST /api/anthropic/v1/messages" },
    }),
    { status: 405, headers: { "Content-Type": "application/json" } }
  );
}
