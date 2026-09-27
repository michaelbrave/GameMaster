import assert from "node:assert/strict";
import type { PlayClient } from "./playthrough";

/** Shared HTTP journey run against both persistence adapters. */
export async function battlefieldJourney(client: PlayClient) {
  const created = await client.post("/api/v1/worlds", {
    name: "Tactical test",
    seed: "tactics",
    gridType: "square-diamond",
  });
  const started = await client.post("/api/v1/sessions", {
    worldId: created.body.id,
    characterName: "Hero",
  });
  const session = started.body.session;
  const url = `/api/v1/sessions/${session.id}/battlefields/0/0`;
  const initial = await client.get(url);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.version, 0);
  assert.equal(initial.body.gridType, "square-diamond");
  assert.equal(
    initial.body.routes[0].destinations.find(
      (r: any) => r.to.q === 2 && r.to.r === 2,
    ).cost,
    2,
  );

  const command = {
    expectedVersion: 0,
    commandId: "corner",
    action: { type: "move", tokenId: session.id, to: { q: 1, r: 1 } },
  };
  const moved = await client.post(url, command);
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual(moved.body.tokens[0].position, { q: 1, r: 1 });
  assert.equal(moved.body.tokens[0].spent, 1);
  assert.deepEqual(
    (await client.get(url)).body,
    moved.body,
    "reopening restores board and movement spent",
  );
  assert.deepEqual(
    (await client.post(url, command)).body,
    moved.body,
    "retry does not spend again",
  );
  assert.equal(
    (await client.post(url, { ...command, commandId: "stale" })).status,
    409,
  );
  assert.equal(
    (await client.post(url, { ...command, action: { type: "reset" } })).status,
    422,
  );
  const blocked = await client.post(url, {
    expectedVersion: 1,
    commandId: "block",
    action: { type: "obstacle", at: { q: 1, r: 1 } },
  });
  assert.equal(blocked.status, 422);
  assert.equal(
    (await client.get(url)).body.version,
    1,
    "failed command leaves no event",
  );

  const obstacle = await client.post(url, {
    expectedVersion: 1,
    commandId: "wall",
    action: { type: "obstacle", at: { q: 2, r: 2 } },
  });
  assert.equal(obstacle.status, 200);
  const enemy = await client.post(url, {
    expectedVersion: 2,
    commandId: "enemy",
    action: {
      type: "add",
      at: { q: 4, r: 0 },
      kind: "enemy",
      label: "Goblin",
      allowance: 4,
    },
  });
  assert.equal(enemy.status, 200);
  const persisted = (await client.get(url)).body;
  assert.equal(persisted.tokens.length, 2);
  assert.deepEqual(persisted.obstacles, [{ q: 2, r: 2 }]);
  assert.equal(
    (await client.get(`/api/v1/sessions/${session.id}`)).body.worldTick,
    0,
  );
  assert.deepEqual(
    (await client.get(`/api/v1/sessions/${session.id}`)).body.session,
    session,
    "sandbox does not alter exploration state",
  );
  assert.equal(
    (await client.get(url.replace("/0/0", "/2/0"))).status,
    422,
    "remote locations cannot be opened",
  );

  const other = await client.post("/api/v1/sessions", {
    worldId: created.body.id,
    characterName: "Other",
  });
  assert.equal(
    (
      await client.get(
        `/api/v1/sessions/${other.body.session.id}/battlefields/0/0`,
      )
    ).body.tokens.length,
    1,
    "sessions keep independent sandbox boards",
  );
  return persisted;
}
