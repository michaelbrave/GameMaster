import { resolve } from "node:path";

export interface AppConfig {
  port: number;
  store: "pg" | "memory";
  databaseUrl: string;
  contentDir: string;
  clientDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

const LEVELS = new Set(["debug", "info", "warn", "error"]);

/** Validate process configuration up front; fail fast with clear messages. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(env.PORT ?? "4020", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `PORT must be an integer between 1 and 65535, got "${env.PORT}"`,
    );
  }
  const storeRaw = env.WORLDFORGE_STORE ?? "pg";
  if (storeRaw !== "pg" && storeRaw !== "memory") {
    throw new Error(
      `WORLDFORGE_STORE must be "pg" or "memory", got "${storeRaw}"`,
    );
  }
  const logLevel = env.LOG_LEVEL ?? "info";
  if (!LEVELS.has(logLevel)) {
    throw new Error(
      `LOG_LEVEL must be one of ${[...LEVELS].join(", ")}, got "${logLevel}"`,
    );
  }
  // dist/src/config.js -> repo root is three directories up.
  const repoRoot = resolve(__dirname, "../../..");
  return {
    port,
    store: storeRaw,
    databaseUrl:
      env.DATABASE_URL ??
      "postgres://worldforge:worldforge@localhost:5432/worldforge",
    contentDir: env.CONTENT_DIR ?? resolve(repoRoot, "content/core"),
    clientDir: env.CLIENT_DIR ?? resolve(repoRoot, "client/public"),
    logLevel: logLevel as AppConfig["logLevel"],
  };
}
