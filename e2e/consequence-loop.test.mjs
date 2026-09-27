/**
 * End-to-end test: boots the real server as a separate OS process and plays
 * the complete consequence loop over HTTP:
 *   generated hex -> travel -> nested encounter -> choice -> remains
 *   -> time advancement -> later consequence.
 *
 * Run from the repository root:  npm run build:server && node --test e2e/
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { before, after } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4789;
const BASE = `http://127.0.0.1:${PORT}`;

const { findDemoSeed } = await import(
  resolve(ROOT, "server/dist/test/integration/playthrough.js")
);

let server;

const client = {
  async get(path) {
    const res = await fetch(`${BASE}${path}`);
    return { status: res.status, body: await res.json() };
  },
  async post(path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  },
};

before(async () => {
  server = spawn("node", [resolve(ROOT, "server/dist/src/index.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      WORLDFORGE_STORE: "memory",
      LOG_LEVEL: "error",
      CONTENT_DIR: resolve(ROOT, "content/core"),
      CLIENT_DIR: "/nonexistent",
    },
    stdio: "ignore",
  });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("server did not become healthy in time");
    await new Promise((r) => setTimeout(r, 150));
  }
});

after(() => {
  server?.kill("SIGTERM");
});

test("complete consequence loop across a real server process", { timeout: 120_000 }, async () => {
  const candidates = Array.from({ length: 25 }, (_, i) => `demo-${i + 1}`);
  const demo = await findDemoSeed(client, candidates);
  assert.ok(demo.steps > 0, "played several commands");
  assert.ok(demo.finalTick >= 3, "world time advanced");
  assert.ok(
    demo.consequenceEvents.some((e) => e.type === "fact_superseded"),
    "a later visit observed an evolved consequence",
  );

  // The creator can inspect the whole causal chain.
  const history = await client.get(`/api/v1/sessions/${demo.sessionId}/creator/history`);
  const types = new Set(history.body.events.map((e) => e.type));
  for (const expected of [
    "world_created", "session_started", "hex_materialized", "hex_discovered",
    "character_moved", "time_advanced", "encounter_started", "encounter_resolved",
    "fact_created", "evolution_evaluated", "fact_superseded",
  ]) {
    assert.ok(types.has(expected), `event type ${expected} present in history`);
  }
  // Traces carry every random value.
  const withRolls = history.body.resolutions.filter((r) => r.rolls.length > 0);
  assert.ok(withRolls.length > 0, "resolutions store roll traces");
});
