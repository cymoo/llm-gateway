import { NextRequest } from "next/server";
import { handleProxy } from "@/lib/proxy/handler";

export async function POST(req: NextRequest) {
  return handleProxy(req, "completions");
}
