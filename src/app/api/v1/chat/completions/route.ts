import { NextRequest } from "next/server";
import { handleProxy } from "@/lib/proxy/handler";
import { seedAdmin } from "@/lib/db/seed";

let seeded = false;

export async function POST(req: NextRequest) {
  if (!seeded) {
    await seedAdmin();
    seeded = true;
  }
  return handleProxy(req, "chat.completions");
}
