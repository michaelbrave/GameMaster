import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import type { Logger } from "../logger";

// dist/src/infrastructure/migrate.js -> server/migrations is ../../../migrations
const MIGRATIONS_DIR = join(__dirname, "../../../migrations");

/** Apply checked-in SQL migrations in filename order, each in one transaction. */
export async function migrate(pool: Pool, logger?: Logger): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    let applied = 0;
    for (const file of files) {
      const version = Number.parseInt(file.split("_")[0], 10);
      const seen = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [version],
      );
      if (seen.rowCount && seen.rowCount > 0) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [version],
        );
        await client.query("COMMIT");
        applied += 1;
        logger?.info("migration applied", { file });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
    return applied;
  } finally {
    client.release();
  }
}

// CLI: `node dist/src/infrastructure/migrate.js`
const isMain = process.argv[1] && process.argv[1].endsWith("migrate.js");
if (isMain) {
  void (async () => {
    const { Pool } = await import("pg");
    const { loadConfig } = await import("../config");
    const { createLogger } = await import("../logger");
    const config = loadConfig();
    const logger = createLogger(config.logLevel);
    const pool = new Pool({ connectionString: config.databaseUrl });
    try {
      const applied = await migrate(pool, logger);
      logger.info("migrations complete", { applied });
    } finally {
      await pool.end();
    }
  })().catch((err) => {
    process.stderr.write(`migration failed: ${String(err)}\n`);
    process.exit(1);
  });
}
