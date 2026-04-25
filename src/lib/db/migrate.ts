/**
 * Run this script once during deployment to apply any pending migrations.
 *
 * Usage:
 *   npx tsx src/lib/db/migrate.ts
 *
 * It uses drizzle-orm's migrate() which automatically:
 *   - Creates the drizzle.__drizzle_migrations tracking table if missing
 *   - Skips migrations that have already been applied
 *   - Applies new migrations in order
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "path";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const db = drizzle(pool);
    console.log("Running database migrations…");
    await migrate(db, {
      migrationsFolder: path.join(process.cwd(), "drizzle/migrations"),
    });
    console.log("Migrations complete.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
