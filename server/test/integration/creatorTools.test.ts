import assert from "node:assert/strict";
import { resolve } from "node:path";
import test, { before, after } from "node:test";
import type { AddressInfo } from "node:net";
import { buildApp, type BuiltApp } from "../../src/app";
import { MemoryStore } from "../../src/infrastructure/memoryStore";
import { httpClient, type PlayClient } from "./playthrough";

let app: BuiltApp;
let client: PlayClient;
let creatorSessionId: string;
let plainSessionId: string;

before(async () => {
  app = await buildApp(
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
  const { port } = app.server.address() as AddressInfo;
  client = httpClient(`http://127.0.0.1:${port}`);
  const w = await client.post("/api/v1/worlds", {
    name: "creator",
    seed: "creator-seed",
  });
  const creator = await client.post("/api/v1/sessions", {
    worldId: w.body.id,
    characterName: "Creator",
    creatorPolicy: { tablePreview: true, completeHistory: true },
  });
  creatorSessionId = creator.body.session.id;
  const plain = await client.post("/api/v1/sessions", {
    worldId: w.body.id,
    characterName: "Player",
  });
  plainSessionId = plain.body.session.id;
});

after(async () => {
  await app.close();
});

test("tables are listed with versions from the content pack", async () => {
  const res = await client.get("/api/v1/tables");
  assert.equal(res.status, 200);
  const ids = res.body.tables.map((t: { id: string }) => t.id);
  for (const expected of [
    "core/travel-encounter",
    "core/bandit-fight",
    "core/remains-ripe",
  ]) {
    assert.ok(ids.includes(expected), `expected ${expected} in table list`);
  }
  const one = await client.get("/api/v1/tables/core%2Ftravel-encounter");
  assert.equal(one.status, 200);
  assert.equal(one.body.versions.length, 1);
});

test("draft validation reports problems and accepts valid drafts", async () => {
  const bad = await client.post("/api/v1/tables/validate", {
    draft: {
      id: "core/bad",
      version: 1,
      purpose: "test",
      label: "Bad",
      selection: { mode: "weighted" },
      entries: [{ id: "x", weight: 0, result: { text: "x" } }],
    },
  });
  assert.equal(bad.status, 200);
  assert.equal(bad.body.valid, false);
  assert.ok(bad.body.errors.length > 0);

  const good = await client.post("/api/v1/tables/validate", {
    draft: {
      id: "core/weather",
      version: 1,
      purpose: "test",
      label: "Weather",
      selection: { mode: "dice", dice: "d6" },
      entries: [
        { id: "rain", range: [1, 3], result: { text: "Rain" } },
        { id: "sun", range: [4, 6], result: { text: "Sun" } },
      ],
    },
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.valid, true, JSON.stringify(good.body.errors));
});

test("seeded preview rolls are deterministic and policy-gated", async () => {
  const req = {
    sessionId: creatorSessionId,
    tableId: "core/travel-encounter",
    seed: "prev",
    count: 4,
  };
  const a = await client.post("/api/v1/tables/preview", req);
  assert.equal(a.status, 200);
  assert.equal(a.body.previews.length, 4);
  const b = await client.post("/api/v1/tables/preview", req);
  assert.deepEqual(b.body, a.body, "same seed yields the same preview");

  const denied = await client.post("/api/v1/tables/preview", {
    ...req,
    sessionId: plainSessionId,
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "forbidden");
});

test("publishing adds a new immutable version and enforces sequence", async () => {
  const definition = {
    id: "core/weather",
    version: 1,
    purpose: "test",
    label: "Weather",
    selection: { mode: "weighted" },
    entries: [{ id: "rain", weight: 1, result: { text: "Rain" } }],
  };
  const published = await client.post("/api/v1/tables", {
    sessionId: creatorSessionId,
    definition,
  });
  assert.equal(published.status, 201);
  assert.deepEqual(published.body, { id: "core/weather", version: 1 });

  const again = await client.post("/api/v1/tables", {
    sessionId: creatorSessionId,
    definition,
  });
  assert.equal(again.status, 409, "republishing the same version conflicts");

  const denied = await client.post("/api/v1/tables", {
    sessionId: plainSessionId,
    definition,
  });
  assert.equal(denied.status, 403);
});

test("creator history requires the complete-history policy", async () => {
  const denied = await client.get(
    `/api/v1/sessions/${plainSessionId}/creator/history`,
  );
  assert.equal(denied.status, 403);
  const allowed = await client.get(
    `/api/v1/sessions/${creatorSessionId}/creator/history`,
  );
  assert.equal(allowed.status, 200);
  assert.ok(Array.isArray(allowed.body.events));
  assert.ok(Array.isArray(allowed.body.resolutions));
});
