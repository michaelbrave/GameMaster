import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test, { before, after } from "node:test";
import type { AddressInfo } from "node:net";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { buildApp, type BuiltApp } from "../../src/app";
import { MemoryStore } from "../../src/infrastructure/memoryStore";
import type { PlayClient } from "../integration/playthrough";

/** Live server responses must validate against the same checked-in contracts. */

const ROOT = resolve(process.cwd(), "..");
const SCHEMA_DIR = join(ROOT, "contracts/json-schema");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

let ajv: Ajv;
let app: BuiltApp;
let client: PlayClient;
let sessionId: string;

before(async () => {
  ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const file of readdirSync(SCHEMA_DIR))
    ajv.addSchema(readJson(join(SCHEMA_DIR, file)));

  app = await buildApp(
    {
      port: 0,
      store: "memory",
      databaseUrl: "",
      contentDir: process.env.CONTENT_DIR ?? join(ROOT, "content/core"),
      clientDir: "/nonexistent",
      logLevel: "error",
    },
    { store: new MemoryStore(), listen: false },
  );
  const { port } = app.server.address() as AddressInfo;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  client = { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b) };

  const world = (
    await client.post("/api/v1/worlds", {
      name: "Contracts",
      seed: "contracts-1",
    })
  ).body;
  const session = (
    await client.post("/api/v1/sessions", {
      worldId: world.id,
      characterName: "Vale",
      creatorPolicy: { tablePreview: true, completeHistory: true },
    })
  ).body;
  sessionId = session.session.id;
});

after(async () => {
  await app.close();
});

function expectValid(schemaRef: string, data: unknown, label: string): void {
  const validate = ajv.getSchema(schemaRef);
  assert.ok(validate, `schema ${schemaRef} not registered`);
  const valid = validate(data);
  assert.ok(
    valid,
    `${label} failed contract ${schemaRef}:\n${JSON.stringify(validate.errors, null, 2)}`,
  );
}

test("live world/session/map/history responses validate", async () => {
  const worldRes = await client.post("/api/v1/worlds", {
    name: "W2",
    seed: "contracts-2",
  });
  expectValid("worldforge/world.json", worldRes.body, "world");

  const sessionRes = await client.get(`/api/v1/sessions/${sessionId}`);
  expectValid("worldforge/session.json", sessionRes.body, "session-state");

  const mapRes = await client.get(`/api/v1/sessions/${sessionId}/map`);
  expectValid("worldforge/map.json", mapRes.body, "map");

  const historyRes = await client.get(`/api/v1/sessions/${sessionId}/history`);
  expectValid("worldforge/history.json", historyRes.body, "history");

  const tablesRes = await client.get("/api/v1/tables");
  expectValid(
    "worldforge/creator.json#/definitions/tableList",
    tablesRes.body,
    "tables",
  );
});

test("live command response validates against the resolution-trace contract", async () => {
  const travel = await client.post(
    `/api/v1/sessions/${sessionId}/commands/travel`,
    {
      idempotencyKey: "live-t1",
      expectedVersion: 0,
      to: { q: 0, r: 1 },
    },
  );
  assert.equal(travel.status, 200, JSON.stringify(travel.body));
  expectValid(
    "worldforge/command-response.json",
    travel.body,
    "command-response",
  );
});

test("live error envelope validates", async () => {
  const missing = await client.get(`/api/v1/sessions/${sessionId}/hexes/-2/2`);
  assert.equal(missing.status, 404);
  expectValid(
    "worldforge/common.json#/definitions/error",
    missing.body,
    "error",
  );
});
