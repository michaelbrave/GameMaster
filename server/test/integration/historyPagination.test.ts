import { resolve } from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { buildApp } from "../../src/app";
import { MemoryStore } from "../../src/infrastructure/memoryStore";
import { historyJourney } from "./historyJourney";
import { httpClient } from "./playthrough";

test(
  "history filters and paginates in the store (memory adapter)",
  { timeout: 60_000 },
  async () => {
    const app = await buildApp(
      {
        port: 0,
        store: "memory",
        databaseUrl: "",
        contentDir:
          process.env.CONTENT_DIR ?? resolve(process.cwd(), "../content/core"),
        clientDir: "/nonexistent",
        logLevel: "error",
      },
      { store: new MemoryStore(), listen: false },
    );
    try {
      const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
      await historyJourney(httpClient(base));
    } finally {
      await app.close();
    }
  },
);
