import assert from "node:assert/strict";
import { resolve } from "node:path";
import test, { before, after } from "node:test";
import type { AddressInfo } from "node:net";
import { buildApp, type BuiltApp } from "../../src/app";
import {
  rebuildHexProjection,
  rebuildSessionState,
} from "../../src/application/projection";
import { DIRECTIONS } from "../../src/domain/axial";
import { MemoryStore } from "../../src/infrastructure/memoryStore";
import {
  findDemoSeed,
  type PlayClient,
  type PlaythroughResult,
} from "./playthrough";

let app: BuiltApp;
let base: string;
let client: PlayClient;
let demo: PlaythroughResult;

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
  const address = app.server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
  client = httpClient(base);
  // Deterministic scan for a seed that demonstrates the complete loop.
  const candidates = Array.from({ length: 25 }, (_, i) => `demo-${i + 1}`);
  demo = await findDemoSeed(client, candidates);
});

after(async () => {
  await app.close();
});

test("health endpoint reports ok", async () => {
  const res = await client.get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
  assert.equal(res.body.contentRelease, "core@1.0.0");
});

test("complete consequence loop: encounter -> remains -> time -> consequence", async () => {
  // The scanned playthrough already ran the full loop over HTTP.
  assert.ok(demo.steps > 0, "playthrough took steps");
  assert.ok(demo.finalTick >= 3, `world time advanced to ${demo.finalTick}`);
  assert.ok(
    demo.consequenceEvents.some((e) => e.type === "fact_superseded"),
    "a linked consequence (fact_superseded) was observed on return",
  );
  // The consequence is traceable: creator history links it to the remains.
  const history = await client.get(
    `/api/v1/sessions/${demo.sessionId}/creator/history`,
  );
  assert.equal(history.status, 200);
  const events = history.body.events as Array<Record<string, any>>;
  const superseded = events.find((e) => e.type === "fact_superseded");
  assert.ok(superseded, "fact_superseded event exists");
  assert.ok(superseded.causationId, "consequence links back to its cause");
  const evaluations = events.filter((e) => e.type === "evolution_evaluated");
  assert.ok(evaluations.length > 0, "evolution evaluations are recorded");
  // Immutable history: the original remains_created event is still present.
  const remainsCreated = events.filter(
    (e) => e.type === "fact_created" && e.payload.category === "remains",
  );
  assert.ok(
    remainsCreated.length > 0,
    "original remains facts remain in history",
  );
});

test("replay of stored resolutions reproduces identical rolls", async () => {
  // Two worlds with the same seed produce identical roll traces for the
  // same first command — 100% deterministic replay.
  const mk = async (name: string) => {
    const w = await client.post("/api/v1/worlds", {
      name,
      seed: "replay-seed",
    });
    const s = await client.post("/api/v1/sessions", {
      worldId: w.body.id,
      characterName: name,
    });
    const travel = await client.post(
      `/api/v1/sessions/${s.body.session.id}/commands/travel`,
      {
        idempotencyKey: `${name}-t1`,
        expectedVersion: 0,
        to: { q: 1, r: 0 },
      },
    );
    return travel.body;
  };
  const a = await mk("replay-a");
  const b = await mk("replay-b");
  assert.deepEqual(a.resolution.rolls, b.resolution.rolls);
  assert.equal(a.resolution.outcome, b.resolution.outcome);
});

test("same seed reproduces generated canonical hex state", async () => {
  const mk = async (name: string) => {
    const w = await client.post("/api/v1/worlds", {
      name,
      seed: "same-generated-state",
    });
    const s = await client.post("/api/v1/sessions", {
      worldId: w.body.id,
      characterName: name,
    });
    const travel = await client.post(
      `/api/v1/sessions/${s.body.session.id}/commands/travel`,
      {
        idempotencyKey: `${name}-t1`,
        expectedVersion: 0,
        to: { q: 1, r: 0 },
      },
    );
    const detail = await client.get(
      `/api/v1/sessions/${s.body.session.id}/hexes/1/0`,
    );
    return { travel: travel.body, detail: detail.body };
  };

  const a = await mk("same-a");
  const b = await mk("same-b");
  assert.deepEqual(a.detail.hex.sites, b.detail.hex.sites);
  assert.deepEqual(a.detail.hex.facts, b.detail.hex.facts);
  assert.deepEqual(a.travel.resolution.rolls, b.travel.resolution.rolls);
});

test("home generation is a single truthful materialization snapshot", async () => {
  const w = await client.post("/api/v1/worlds", {
    name: "home-trace",
    seed: "home-trace-seed",
  });
  const s = await client.post("/api/v1/sessions", {
    worldId: w.body.id,
    characterName: "Trace",
    creatorPolicy: { completeHistory: true },
  });
  const history = await client.get(
    `/api/v1/sessions/${s.body.session.id}/creator/history`,
  );
  // The home hex is the origin; identify it by coordinate, not by an
  // undeclared flag in the payload.
  const materialized = history.body.events.find(
    (event: { type: string; location?: { q: number; r: number } | null }) =>
      event.type === "hex_materialized" &&
      event.location?.q === 0 &&
      event.location?.r === 0,
  );
  assert.ok(materialized);

  // The recorded roll trace is the site-table roll (terrain is forced at world
  // creation, so no terrain roll is recorded).
  assert.ok(Array.isArray(materialized.payload.rolls));
  assert.ok(materialized.payload.rolls.length > 0);

  // The snapshot is complete: it states the sites and facts the hex actually
  // has, so a replay from the event stream alone reproduces the hex.
  const detail = await client.get(
    `/api/v1/sessions/${s.body.session.id}/hexes/0/0`,
  );
  assert.deepEqual(materialized.payload.sites, detail.body.hex.sites);
  assert.deepEqual(materialized.payload.facts, detail.body.hex.facts);

  // Sites and facts travel in that one snapshot rather than as separate
  // site_added/fact_created events, matching every lazily generated hex.
  const originFollowups = history.body.events.filter(
    (event: { type: string; location?: { q: number; r: number } | null }) =>
      (event.type === "site_added" || event.type === "fact_created") &&
      event.location?.q === 0 &&
      event.location?.r === 0,
  );
  assert.deepEqual(originFollowups, []);
});

test("idempotent retry returns the original result without rerolling", async () => {
  const w = await client.post("/api/v1/worlds", {
    name: "idem",
    seed: "idem-seed",
  });
  const s = await client.post("/api/v1/sessions", {
    worldId: w.body.id,
    characterName: "Idem",
  });
  const sid = s.body.session.id;
  const command = {
    idempotencyKey: "travel-once",
    expectedVersion: 0,
    to: { q: 1, r: 0 },
  };
  const first = await client.post(
    `/api/v1/sessions/${sid}/commands/travel`,
    command,
  );
  assert.equal(first.status, 200);
  const historyBefore = await client.get(`/api/v1/sessions/${sid}/history`);
  const retry = await client.post(
    `/api/v1/sessions/${sid}/commands/travel`,
    command,
  );
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body, first.body, "retry replays the stored response");
  const historyAfter = await client.get(`/api/v1/sessions/${sid}/history`);
  assert.equal(
    historyAfter.body.total,
    historyBefore.body.total,
    "no duplicate events on retry",
  );

  // Same key, different payload: rejected, never rolled.
  const conflict = await client.post(
    `/api/v1/sessions/${sid}/commands/travel`,
    {
      idempotencyKey: "travel-once",
      expectedVersion: first.body.session.version,
      to: { q: 0, r: 1 },
    },
  );
  assert.equal(conflict.status, 422);
  assert.equal(conflict.body.error.code, "command_rejected");
});

test("optimistic concurrency rejects stale expected versions", async () => {
  const w = await client.post("/api/v1/worlds", {
    name: "occ",
    seed: "occ-seed",
  });
  const s = await client.post("/api/v1/sessions", {
    worldId: w.body.id,
    characterName: "Occ",
  });
  const sid = s.body.session.id;
  const ok = await client.post(`/api/v1/sessions/${sid}/commands/travel`, {
    idempotencyKey: "occ-t1",
    expectedVersion: 0,
    to: { q: 1, r: 0 },
  });
  assert.equal(ok.status, 200);
  const stale = await client.post(`/api/v1/sessions/${sid}/commands/travel`, {
    idempotencyKey: "occ-t2",
    expectedVersion: 0, // session has moved on
    to: { q: 0, r: 1 },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "version_conflict");
  assert.ok(stale.body.error.requestId, "error carries a request id");
});

test("server never leaks undiscovered hex state", async () => {
  const w = await client.post("/api/v1/worlds", {
    name: "hidden",
    seed: "hidden-seed",
  });
  const s = await client.post("/api/v1/sessions", {
    worldId: w.body.id,
    characterName: "Hide",
  });
  const sid = s.body.session.id;

  const map = await client.get(`/api/v1/sessions/${sid}/map`);
  assert.equal(map.status, 200);
  assert.equal(map.body.hexes.length, 1, "only the home hex is discovered");
  assert.deepEqual([map.body.hexes[0].q, map.body.hexes[0].r], [0, 0]);

  const detail = await client.get(`/api/v1/sessions/${sid}/hexes/1/0`);
  assert.equal(
    detail.status,
    404,
    "undiscovered hex is indistinguishable from nonexistent",
  );
  assert.equal(detail.body.error.code, "not_found");

  // History contains nothing about undiscovered hexes.
  const history = await client.get(`/api/v1/sessions/${sid}/history`);
  const mentions = (
    history.body.entries as Array<{ location: { q: number; r: number } | null }>
  ).filter((e) => e.location && !(e.location.q === 0 && e.location.r === 0));
  assert.equal(mentions.length, 0);
});

test("projection rebuilds match incremental projections", async () => {
  const store = app.store;
  await store.withTransaction(async (tx) => {
    const hexes = await tx.listHexProjections(demo.worldId);
    assert.ok(hexes.length > 1, "several hexes were materialized");
    for (const hex of hexes) {
      const rebuilt = await rebuildHexProjection(tx, demo.worldId, hex);
      assert.deepEqual(rebuilt, hex, `hex ${hex.q},${hex.r} rebuild matches`);
    }
    const sessionRow = await tx.getSession(demo.sessionId);
    const rebuiltSession = await rebuildSessionState(tx, demo.sessionId);
    assert.ok(sessionRow && rebuiltSession);
    assert.deepEqual(
      {
        q: rebuiltSession.q,
        r: rebuiltSession.r,
        version: rebuiltSession.version,
        pending: rebuiltSession.pendingEncounter,
        policy: rebuiltSession.creatorPolicy,
      },
      {
        q: sessionRow.q,
        r: sessionRow.r,
        version: sessionRow.version,
        pending: sessionRow.pendingEncounter,
        policy: sessionRow.creatorPolicy,
      },
    );
  });
});

test("playthrough log is human-readable", () => {
  assert.ok(demo.log.length > 3);
  for (const line of demo.log) assert.equal(typeof line, "string");
});

test("combat presentation and opponent label are declared by content", async () => {
  // The client must not need to know any authored choice id: the surface it
  // opens and the label it displays both arrive in the payload.
  type Choice = {
    id: string;
    label: string;
    presentation?: string;
  };
  type Pending = {
    choices: Choice[];
    asset?: string;
    assetLabel?: string;
  };

  let found: Pending | null = null;
  let foundChoice: Choice | null = null;
  let foundSessionId = "";
  let expectedVersion = 0;

  outer: for (let i = 0; i < 12 && !found; i += 1) {
    const w = await client.post("/api/v1/worlds", {
      name: `presentation-${i}`,
      seed: `presentation-seed-${i}`,
    });
    const s = await client.post("/api/v1/sessions", {
      worldId: w.body.id,
      characterName: "Scout",
    });
    expectedVersion = 0;
    const sessionId = s.body.session.id as string;
    for (let step = 0; step < 6; step += 1) {
      const res = await client.post(
        `/api/v1/sessions/${sessionId}/commands/travel`,
        {
          idempotencyKey: `presentation-${i}-${step}`,
          expectedVersion,
          to: DIRECTIONS[step % DIRECTIONS.length],
        },
      );
      if (res.status !== 200) break;
      expectedVersion = res.body.session.version as number;
      const pending = res.body.session.pendingEncounter as Pending | null;
      const combat = pending?.choices.find((c) => c.presentation);
      if (pending && combat) {
        found = pending;
        foundChoice = combat;
        foundSessionId = sessionId;
        break outer;
      }
      if (!pending) break;
    }
  }

  assert.ok(
    found,
    "an encounter with a declared presentation surface was reached",
  );
  assert.ok(foundChoice);

  // The surface is named, not inferred from the id: renaming the choice in
  // content must not change this.
  assert.equal(foundChoice!.presentation, "battlefield");
  // Non-combat choices in the same encounter declare no surface.
  for (const choice of found!.choices) {
    if (choice.id !== foundChoice!.id) {
      assert.equal(
        choice.presentation,
        undefined,
        `choice ${choice.id} should not declare a presentation surface`,
      );
    }
  }
  // The opponent's display name is authored, not parsed from the asset ref.
  assert.ok(found!.asset, "encounter references a visual asset");
  assert.ok(
    found!.assetLabel && found!.assetLabel.length > 0,
    "encounter carries an authored asset label",
  );
  assert.ok(
    !/^(icon:|[a-z]+-)/.test(found!.assetLabel!),
    `asset label "${found!.assetLabel}" must not be a raw asset reference`,
  );

  // The declaration survives a round trip through the session read endpoint.
  const state = await client.get(`/api/v1/sessions/${foundSessionId}`);
  assert.equal(state.status, 200);
  assert.equal(
    (state.body.session.pendingEncounter as Pending).choices.find(
      (c) => c.id === foundChoice!.id,
    )?.presentation,
    "battlefield",
  );
});
