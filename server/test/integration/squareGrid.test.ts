import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { loadContentPack } from "../../src/application/content";
import { createWorld, createSession } from "../../src/application/worlds";
import { getMap, getSessionState } from "../../src/application/queries";
import { travel } from "../../src/application/travel";
import { MemoryStore } from "../../src/infrastructure/memoryStore";
import { rebuildSessionState } from "../../src/application/projection";

test("square world travels through a saved diamond and preserves replay and discovery", async () => {
  const pack = loadContentPack(resolve(process.cwd(), "../content/core"));
  // Isolate movement from random obstacles and encounters.
  for (const terrain of Object.values(pack.terrain)) terrain.passable = true;
  const encounter = pack.tables.find(
    (t) => t.id === pack.worldgen.encounterTable.id,
  )!;
  encounter.entries = [
    { id: "quiet", weight: 1, result: { text: "Quiet road." } },
  ];
  const engine = { pack, now: () => new Date().toISOString() };
  const store = new MemoryStore();
  const world = await createWorld(store, engine, {
    name: "Corners",
    seed: "corners",
    gridType: "square-diamond",
  });
  const session = await createSession(store, engine, {
    worldId: world.id,
    characterName: "Walker",
  });
  const initial = await getMap(store, engine, session.id);
  assert.equal(initial.gridType, "square-diamond");
  assert.equal(initial.reachable.length, 8);
  assert.equal(initial.hexes.length, 1);
  await assert.rejects(
    travel(store, engine, session.id, {
      to: { q: 2, r: 2 },
      expectedVersion: 0,
      idempotencyKey: "skip",
    }),
  );
  const command = {
    to: { q: 1, r: 1 },
    expectedVersion: 0,
    idempotencyKey: "corner",
  };
  const corner = await travel(store, engine, session.id, command);
  assert.deepEqual(corner.session.position, command.to);
  assert.deepEqual(await travel(store, engine, session.id, command), corner);
  assert.equal(
    (await getSessionState(store, engine, session.id)).reachable.length,
    4,
  );
  const rebuilt = await store.withTransaction((tx) =>
    rebuildSessionState(tx, session.id),
  );
  assert.equal(rebuilt?.q, 1);
  assert.equal(rebuilt?.r, 1);
  const end = await travel(store, engine, session.id, {
    to: { q: 2, r: 2 },
    expectedVersion: 1,
    idempotencyKey: "diagonal",
  });
  assert.deepEqual(end.session.position, { q: 2, r: 2 });
  assert.equal((await getMap(store, engine, session.id)).hexes.length, 3);
  // This position lies outside the old axial radius: generation must use the selected topology.
  await travel(store, engine, session.id, {
    to: { q: 4, r: 2 },
    expectedVersion: 2,
    idempotencyKey: "edge",
  });
  assert.equal((await getMap(store, engine, session.id)).hexes.length, 4);
});

test("legacy world creation remains hex and unknown layouts are rejected", async () => {
  const engine = {
    pack: loadContentPack(resolve(process.cwd(), "../content/core")),
    now: () => new Date().toISOString(),
  };
  const store = new MemoryStore();
  const world = await createWorld(store, engine, { name: "Legacy" });
  assert.equal(world.gridType, "hex");
  await assert.rejects(
    createWorld(store, engine, { name: "Bad", gridType: "invalid" as "hex" }),
  );
});
