import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { buildApp, type BuiltApp } from "../app";
import { MemoryStore } from "../infrastructure/memoryStore";

/**
 * Regenerate contracts/fixtures from a real engine run (deterministic seed),
 * so fixtures always match actual server responses. Run: npm run fixtures.
 */

const FIXTURES_DIR =
  process.env.FIXTURES_DIR ?? resolve(process.cwd(), "../contracts/fixtures");

type Call = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ status: number; body: any }>;

function makeCall(base: string): Call {
  return async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
}

/** Probe a candidate seed: first east travel must start a fight whose
 *  resolution leaves evolving remains at (1,0). */
async function probeSeed(call: Call, seed: string): Promise<boolean> {
  const world = (
    await call("POST", "/api/v1/worlds", { name: `probe-${seed}`, seed })
  ).body;
  const session = (
    await call("POST", "/api/v1/sessions", {
      worldId: world.id,
      characterName: "Probe",
      creatorPolicy: { tablePreview: true, completeHistory: true },
    })
  ).body;
  const sid = session.session.id;
  const travel = (
    await call("POST", `/api/v1/sessions/${sid}/commands/travel`, {
      idempotencyKey: "p-t1",
      expectedVersion: 0,
      to: { q: 1, r: 0 },
    })
  ).body;
  if (travel.resolution?.outcome !== "encounter") return false;
  const fight = travel.session.pendingEncounter.choices.find(
    (c: { id: string }) => c.id === "fight",
  );
  if (!fight) return false;
  const action = (
    await call("POST", `/api/v1/sessions/${sid}/commands/encounter-action`, {
      idempotencyKey: "p-a1",
      expectedVersion: travel.session.version,
      choiceId: "fight",
    })
  ).body;
  const detail = (await call("GET", `/api/v1/sessions/${sid}/hexes/1/0`)).body;
  return (
    action.resolution?.outcome === "resolved" &&
    Boolean(
      detail.hex?.facts?.some(
        (f: { category: string }) => f.category === "remains",
      ),
    )
  );
}

async function main(): Promise<void> {
  const app: BuiltApp = await buildApp(
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
  const call = makeCall(`http://127.0.0.1:${port}`);
  const write = (name: string, data: unknown) => {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    writeFileSync(
      join(FIXTURES_DIR, name),
      `${JSON.stringify(data, null, 2)}\n`,
    );
    console.log(`wrote ${name}`);
  };

  let seed = "";
  for (const candidate of Array.from(
    { length: 30 },
    (_, i) => `fixture-${i + 1}`,
  )) {
    if (await probeSeed(call, candidate)) {
      seed = candidate;
      break;
    }
  }
  if (!seed)
    throw new Error("no fixture seed produced the required encounter path");
  console.log(`fixture seed: ${seed}`);

  // Canonical fixture run.
  const world = (
    await call("POST", "/api/v1/worlds", { name: "Fixture World", seed })
  ).body;
  write("world.json", world);
  const sessionState = (
    await call("POST", "/api/v1/sessions", {
      worldId: world.id,
      characterName: "Wren",
      creatorPolicy: { tablePreview: true, completeHistory: true },
    })
  ).body;
  write("session-state.json", sessionState);
  const sid = sessionState.session.id;

  const encounter = (
    await call("POST", `/api/v1/sessions/${sid}/commands/travel`, {
      idempotencyKey: "fixture-t1",
      expectedVersion: 0,
      to: { q: 1, r: 0 },
    })
  ).body;
  write("command-response-travel-encounter.json", encounter);
  const choiceId = encounter.session.pendingEncounter.choices[0].id;
  const action = (
    await call("POST", `/api/v1/sessions/${sid}/commands/encounter-action`, {
      idempotencyKey: "fixture-a1",
      expectedVersion: encounter.session.version,
      choiceId,
    })
  ).body;
  write("command-response-action.json", action);

  // Wander to advance time, then return to observe the consequence.
  let state = (await call("GET", `/api/v1/sessions/${sid}`)).body;
  const wanderTargets = [
    { q: 2, r: 0 },
    { q: 2, r: -1 },
    { q: 1, r: -1 },
    { q: 0, r: 0 },
    { q: 1, r: 0 },
  ];
  let leg = 0;
  for (const target of wanderTargets) {
    leg += 1;
    const res = await call("POST", `/api/v1/sessions/${sid}/commands/travel`, {
      idempotencyKey: `fixture-w${leg}`,
      expectedVersion: state.session.version,
      to: target,
    });
    if (res.status !== 200) continue;
    state = (await call("GET", `/api/v1/sessions/${sid}`)).body;
    if (state.session.pendingEncounter) {
      const flee =
        state.session.pendingEncounter.choices.find(
          (c: { id: string }) => c.id === "flee",
        ) ?? state.session.pendingEncounter.choices[0];
      await call("POST", `/api/v1/sessions/${sid}/commands/encounter-action`, {
        idempotencyKey: `fixture-wx${leg}`,
        expectedVersion: state.session.version,
        choiceId: flee.id,
      });
      state = (await call("GET", `/api/v1/sessions/${sid}`)).body;
    }
  }

  write("map.json", (await call("GET", `/api/v1/sessions/${sid}/map`)).body);
  write(
    "hex-detail.json",
    (await call("GET", `/api/v1/sessions/${sid}/hexes/1/0`)).body,
  );
  write(
    "history.json",
    (await call("GET", `/api/v1/sessions/${sid}/history`)).body,
  );
  write(
    "creator-history.json",
    (await call("GET", `/api/v1/sessions/${sid}/creator/history`)).body,
  );
  write("tables.json", (await call("GET", "/api/v1/tables")).body);
  write(
    "table.json",
    (await call("GET", "/api/v1/tables/core%2Ftravel-encounter")).body,
  );
  write(
    "table-validate.json",
    (
      await call("POST", "/api/v1/tables/validate", {
        draft: {
          id: "core/broken",
          version: 1,
          purpose: "test",
          label: "Broken",
          selection: { mode: "weighted" },
          entries: [{ id: "x", weight: 0, result: { text: "x" } }],
        },
      })
    ).body,
  );
  write(
    "table-preview.json",
    (
      await call("POST", "/api/v1/tables/preview", {
        sessionId: sid,
        tableId: "core/travel-encounter",
        seed: "fixture-preview",
        count: 3,
      })
    ).body,
  );
  write(
    "error.json",
    (await call("GET", `/api/v1/sessions/${sid}/hexes/-2/2`)).body,
  );

  // A plain "moved" travel outcome from a quiet seed.
  const quietWorld = (
    await call("POST", "/api/v1/worlds", {
      name: "Quiet",
      seed: "fixture-quiet-1",
    })
  ).body;
  const quietSession = (
    await call("POST", "/api/v1/sessions", {
      worldId: quietWorld.id,
      characterName: "Pax",
    })
  ).body;
  const moved = (
    await call(
      "POST",
      `/api/v1/sessions/${quietSession.session.id}/commands/travel`,
      { idempotencyKey: "q1", expectedVersion: 0, to: { q: 1, r: 0 } },
    )
  ).body;
  write("command-response-travel-moved.json", moved);

  await app.close();
  console.log(`fixtures written to ${FIXTURES_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
