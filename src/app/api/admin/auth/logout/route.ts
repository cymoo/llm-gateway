import { NextRequest } from "next/server";
import { getAdminUser } from "@/app/api/admin/middleware";
import { recordAudit } from "@/lib/audit/recorder";

export async function POST(req: NextRequest) {
  // Identify the admin from the still-valid cookie before clearing it.
  const admin = await getAdminUser(req);
  if (admin) {
    recordAudit({
      adminId: admin.userId,
      adminEmail: admin.email,
      action: "auth.logout",
      resourceType: "auth",
      resourceLabel: admin.email,
      status: "success",
      req,
    });
  }

  const response = Response.json({ success: true });
  response.headers.set(
    "Set-Cookie",
    "admin_token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
  );
  return response;
}
