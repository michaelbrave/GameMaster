import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { before, after } from "node:test";
/* embedded-postgres ships an exports map that classic node module resolution
 * cannot see; in CommonJS output a plain require works fine. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const EmbeddedPostgres = require("embedded-postgres").default as new (options: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
}) => {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createDatabase(name: string): Promise<void>;
};
import { buildApp, type BuiltApp } from "../../src/app";
import { migrate } from "../../src/infrastructure/migrate";
import { PgStore } from "../../src/infrastructure/pgStore";
import { rebuildHexProjection } from "../../src/application/projection";
import type { PlayClient } from "./playthrough";
import { findDemoSeed } from "./playthrough";

/**
 * PostgreSQL adapter integration test. Uses embedded-postgres (real server
 * binaries, current user, no docker) so migrations and SQL behavior are
 * exercised for real. Set WORLDFORGE_SKIP_PG=1 to skip.
 */

const SKIP = process.env.WORLDFORGE_SKIP_PG === "1";
const PG_PORT = 55445;

let pg: InstanceType<typeof EmbeddedPostgres>;
let dataDir: string;
let store: PgStore;
let app: BuiltApp;
let client: PlayClient;

function httpClient(baseUrl: string): PlayClient {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body),
  };
}

before(async () => {
  if (SKIP) return;
  dataDir = mkdtempSync(join(tmpdir(), "worldforge-pg-test-"));
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "worldforge",
    password: "worldforge",
    port: PG_PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("worldforge");
  const url = `postgres://worldforge:worldforge@127.0.0.1:${PG_PORT}/worldforge`;
  store = new PgStore(url);
  const applied = await migrate(store.pool);
  assert.ok(applied >= 1, "initial migration applied");
  const reapplied = await migrate(store.pool);
  assert.equal(reapplied, 0, "migrations are idempotent");

  app = await buildApp(
    {
      port: 0,
      store: "pg",
      databaseUrl: url,
      contentDir:
        process.env.CONTENT_DIR ?? resolve(process.cwd(), "../content/core"),
      clientDir: "/nonexistent",
      logLevel: "error",
    },
    { store, listen: false },
  );
  const address = app.server.address() as import("node:net").AddressInfo;
  client = httpClient(`http://127.0.0.1:${address.port}`);
});

after(async () => {
  if (SKIP) return;
  await app.close();
  await pg.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

test(
  "pg adapter runs the complete consequence loop",
  { skip: SKIP, timeout: 120_000 },
  async () => {
    const candidates = Array.from({ length: 25 }, (_, i) => `demo-${i + 1}`);
    const demo = await findDemoSeed(client, candidates);
    assert.ok(
      demo.consequenceEvents.some((e) => e.type === "fact_superseded"),
      "consequence loop completed on PostgreSQL",
    );
    await store.withTransaction(async (tx) => {
      const hexes = await tx.listHexProjections(demo.worldId);
      assert.ok(hexes.length > 1);
      for (const hex of hexes) {
        const rebuilt = await rebuildHexProjection(tx, demo.worldId, hex);
        assert.deepEqual(
          rebuilt,
          hex,
          `hex ${hex.q},${hex.r} rebuild matches on pg`,
        );
      }
    });
  },
);

test(
  "pg adapter enforces idempotency and concurrency at the SQL level",
  { skip: SKIP, timeout: 60_000 },
  async () => {
    const w = await client.post("/api/v1/worlds", {
      name: "pg-idem",
      seed: "pg-idem-seed",
    });
    const s = await client.post("/api/v1/sessions", {
      worldId: w.body.id,
      characterName: "Pg",
    });
    const sid = s.body.session.id;
    const command = {
      idempotencyKey: "pg-t1",
      expectedVersion: 0,
      to: { q: 1, r: 0 },
    };
    const first = await client.post(
      `/api/v1/sessions/${sid}/commands/travel`,
      command,
    );
    assert.equal(first.status, 200);
    const retry = await client.post(
      `/api/v1/sessions/${sid}/commands/travel`,
      command,
    );
    assert.deepEqual(retry.body, first.body);
    const stale = await client.post(`/api/v1/sessions/${sid}/commands/travel`, {
      idempotencyKey: "pg-t2",
      expectedVersion: 0,
      to: { q: 0, r: 1 },
    });
    assert.equal(stale.status, 409);
  },
);

test(
  "PostgreSQL saves the square-diamond layout and exposes eight initial exits",
  { skip: SKIP },
  async () => {
    const created = await client.post("/api/v1/worlds", {
      name: "Diamond save",
      seed: "diamond",
      gridType: "square-diamond",
    });
    assert.equal(created.status, 201);
    const loaded = await client.get("/api/v1/worlds/" + created.body.id);
    assert.equal(loaded.body.gridType, "square-diamond");
    const started = await client.post("/api/v1/sessions", {
      worldId: created.body.id,
      characterName: "Walker",
    });
    assert.equal(started.status, 201);
    assert.equal(started.body.reachable.length, 8);
    const map = await client.get(
      "/api/v1/sessions/" + started.body.session.id + "/map",
    );
    assert.equal(map.body.gridType, "square-diamond");
    assert.equal(map.body.hexes.length, 1);
  },
);

test(
  "PostgreSQL persists the complete battlefield journey",
  { skip: SKIP },
  async () => {
    const { battlefieldJourney } = await import("./battlefieldJourney");
    await battlefieldJourney(client);
  },
);
