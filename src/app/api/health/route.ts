import { db } from "@/lib/db";

export async function GET() {
  let dbStatus = "connected";
  try {
    await db.execute("SELECT 1");
  } catch {
    dbStatus = "disconnected";
  }

  return Response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    database: dbStatus,
  });
}
