import { db } from "./index";
import { users } from "./schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export async function seedAdmin() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminName = process.env.ADMIN_NAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminName || !adminPassword) {
      console.log("[seed] Admin env vars not set, skipping seed.");
      return;
    }

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.isAdmin, true))
      .limit(1);

    if (existing.length > 0) {
      return;
    }

    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const apiKey = `sk-${crypto.randomBytes(16).toString("hex")}`;

    await db.insert(users).values({
      name: adminName,
      email: adminEmail,
      passwordHash,
      apiKey,
      isActive: true,
      isAdmin: true,
    });

    console.log(`[seed] Admin user created: ${adminEmail}`);
  } catch (err) {
    console.error("[seed] Failed to seed admin:", err);
  }
}
