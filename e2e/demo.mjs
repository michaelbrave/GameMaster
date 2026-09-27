/**
 * Runnable demonstration of the complete consequence loop for humans:
 * boots the server in-process and prints a narrated transcript.
 *
 * Run from the repository root:  npm run demo
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.env.CONTENT_DIR = process.env.CONTENT_DIR ?? resolve(ROOT, "content/core");

const { buildApp } = await import(resolve(ROOT, "server/dist/src/app.js"));
const { MemoryStore } = await import(resolve(ROOT, "server/dist/src/infrastructure/memoryStore.js"));
const { findDemoSeed } = await import(resolve(ROOT, "server/dist/test/integration/playthrough.js"));

const app = await buildApp(
  {
    port: 0,
    store: "memory",
    databaseUrl: "",
    contentDir: process.env.CONTENT_DIR,
    clientDir: "/nonexistent",
    logLevel: "error",
  },
  { store: new MemoryStore(), listen: false },
);
const { port } = app.server.address();

const client = {
  async get(path) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  },
  async post(path, body) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  },
};

const candidates = Array.from({ length: 25 }, (_, i) => `demo-${i + 1}`);
const demo = await findDemoSeed(client, candidates);

console.log("=".repeat(72));
console.log("WORLDFORGE CONSEQUENCE-LOOP DEMONSTRATION");
console.log("=".repeat(72));
console.log(`world seed: ${demo.seed}   world: ${demo.worldId}`);
console.log(`encounter hex: ${demo.encounterHex.q},${demo.encounterHex.r}   steps: ${demo.steps}   final tick: ${demo.finalTick}`);
console.log("-".repeat(72));
console.log("TRANSCRIPT (player-visible log):");
for (const line of demo.log) console.log(`  ${line}`);
console.log("-".repeat(72));
const history = await client.get(`/api/v1/sessions/${demo.sessionId}/creator/history`);
const counts = {};
for (const e of history.body.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
console.log("EVENT COUNTS (creator view):");
for (const [type, count] of Object.entries(counts).sort()) {
  console.log(`  ${type.padEnd(22)} ${count}`);
}
const superseded = history.body.events.find((e) => e.type === "fact_superseded");
console.log("-".repeat(72));
console.log("CONSEQUENCE TRACE:");
console.log(`  remains event:    ${superseded?.causationId}`);
console.log(`  consequence event: ${superseded?.id}`);
console.log(`  outcome: ${superseded?.payload?.category} -> ${superseded?.payload?.successor?.category}`);
console.log("=".repeat(72));
await app.close();
