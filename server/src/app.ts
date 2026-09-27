import type { Server } from "node:http";
import { loadContentPack, type ContentPack } from "./application/content";
import type { Engine } from "./application/engine";
import type { AppConfig } from "./config";
import { HttpApp } from "./http/server";
import { registerRoutes } from "./http/routes";
import { MemoryStore } from "./infrastructure/memoryStore";
import type { Store } from "./infrastructure/store";
import { createLogger, type Logger } from "./logger";

export interface BuiltApp {
  http: HttpApp;
  server: Server;
  store: Store;
  pack: ContentPack;
  engine: Engine;
  config: AppConfig;
  logger: Logger;
  close(): Promise<void>;
}

/** Seed immutable content-pack table versions into the store (idempotent). */
export async function seedContentTables(
  store: Store,
  pack: ContentPack,
): Promise<void> {
  await store.withTransaction(async (tx) => {
    for (const table of pack.tables) {
      await tx.seedTable({ ...table, lifecycle: "published" });
    }
  });
}

export interface BuildOptions {
  store?: Store;
  now?: () => string;
  listen?: boolean;
}

/**
 * Composition root. The store is injectable so tests can use the in-memory
 * adapter or a scratch PostgreSQL database; production uses PostgreSQL.
 */
export async function buildApp(
  config: AppConfig,
  opts: BuildOptions = {},
): Promise<BuiltApp> {
  const logger = createLogger(config.logLevel);
  const pack = loadContentPack(config.contentDir);
  let store = opts.store;
  let ownsStore = false;
  if (!store) {
    if (config.store === "pg") {
      const { PgStore } = await import("./infrastructure/pgStore");
      const { migrate } = await import("./infrastructure/migrate");
      const pg = new PgStore(config.databaseUrl);
      await migrate(pg.pool, logger);
      store = pg;
    } else {
      store = new MemoryStore();
    }
    ownsStore = true;
  }
  await seedContentTables(store, pack);
  const engine: Engine = {
    pack,
    now: opts.now ?? (() => new Date().toISOString()),
  };
  const http = new HttpApp({ logger, clientDir: config.clientDir });
  registerRoutes(http, { store, engine, logger });
  const shouldListen = opts.listen ?? true;
  const server = shouldListen ? http.listen(config.port) : http.listen(0);
  if (shouldListen) {
    logger.info("worldforge server listening", {
      port: config.port,
      store: config.store,
      contentRelease: pack.release,
    });
  }
  return {
    http,
    server,
    store,
    pack,
    engine,
    config,
    logger,
    async close() {
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
      if (ownsStore) await store.close();
    },
  };
}
