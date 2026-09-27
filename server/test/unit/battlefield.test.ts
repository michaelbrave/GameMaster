import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBattleAction,
  routesFor,
  type Battlefield,
} from "../../src/domain/battlefield";

const board = (): Battlefield => ({
  version: 0,
  location: { q: 0, r: 0 },
  gridType: "square-diamond",
  radius: 4,
  feetPerStep: 5,
  terrain: "Plains",
  color: "#abc",
  obstacles: [],
  tokens: [
    {
      id: "hero",
      label: "Hero",
      kind: "character",
      position: { q: 0, r: 0 },
      allowance: 6,
      spent: 0,
    },
  ],
});

test("cardinal and diamond steps cost one; diagonal square costs two", () => {
  const b = board();
  const routes = routesFor(b, b.tokens[0]);
  for (const [q, r, cost] of [
    [2, 0, 1],
    [1, 1, 1],
    [2, 2, 2],
    [-2, -2, 2],
  ]) {
    assert.equal(routes.find((p) => p.to.q === q && p.to.r === r)?.cost, cost);
  }
  const moved = applyBattleAction(
    b,
    { type: "move", tokenId: "hero", to: { q: 1, r: 1 } },
    "new",
  );
  assert.equal(moved.tokens[0].spent, 1);
  assert.equal(b.tokens[0].spent, 0, "original snapshot unchanged");
  assert.equal(
    routesFor(moved, moved.tokens[0]).find((p) => p.to.q === 2 && p.to.r === 2)
      ?.cost,
    1,
  );
});

test("obstacles and all tokens block routes; budget and board edges are enforced", () => {
  let b = board();
  b.tokens[0].allowance = 2;
  b = applyBattleAction(b, { type: "obstacle", at: { q: 2, r: 0 } }, "");
  b = applyBattleAction(
    b,
    {
      type: "add",
      at: { q: 1, r: 1 },
      kind: "enemy",
      label: "Goblin",
      allowance: 3,
    },
    "goblin",
  );
  b = applyBattleAction(
    b,
    {
      type: "add",
      at: { q: -1, r: -1 },
      kind: "object",
      label: "Crate",
      allowance: 1,
    },
    "crate",
  );
  const routes = routesFor(b, b.tokens[0]);
  assert.ok(
    routes.every(
      (r) =>
        r.cost <= 2 &&
        r.path.every(
          (p) =>
            !b.obstacles.some((o) => o.q === p.q && o.r === p.r) &&
            !b.tokens
              .slice(1)
              .some((t) => t.position.q === p.q && t.position.r === p.r),
        ),
    ),
  );
  assert.equal(routesFor(b, b.tokens[2]).length, 0);
  for (const to of [
    { q: 2, r: 0 },
    { q: 1, r: 1 },
    { q: 8, r: 8 },
    { q: 0, r: 1 },
    { q: 10, r: 0 },
  ]) {
    assert.throws(() =>
      applyBattleAction(b, { type: "move", tokenId: "hero", to }, ""),
    );
  }
  assert.throws(() =>
    applyBattleAction(
      b,
      {
        type: "add",
        at: { q: 0, r: 0 },
        label: "Overlap",
        kind: "enemy",
        allowance: 1,
      },
      "x",
    ),
  );
});

test("movement accumulates, reset restores budget, scaling cannot discard occupants", () => {
  let b = board();
  b.tokens[0].allowance = 1;
  b = applyBattleAction(
    b,
    { type: "move", tokenId: "hero", to: { q: 2, r: 0 } },
    "",
  );
  assert.equal(routesFor(b, b.tokens[0]).length, 0);
  b = applyBattleAction(b, { type: "reset" }, "");
  assert.equal(b.tokens[0].spent, 0);
  b = applyBattleAction(
    b,
    {
      type: "add",
      at: { q: 8, r: 8 },
      label: "Edge",
      kind: "object",
      allowance: 1,
    },
    "edge",
  );
  assert.throws(() =>
    applyBattleAction(b, { type: "settings", radius: 2, feetPerStep: 5 }, ""),
  );
  assert.throws(() =>
    applyBattleAction(b, { type: "settings", radius: 20, feetPerStep: 5 }, ""),
  );
  b = applyBattleAction(b, { type: "remove", tokenId: "edge" }, "");
  assert.equal(
    applyBattleAction(b, { type: "settings", radius: 2, feetPerStep: 10 }, "")
      .feetPerStep,
    10,
  );
});

test("hex battlefield keeps six one-step neighbors", () => {
  const b = board();
  b.gridType = "hex";
  b.tokens[0].allowance = 1;
  assert.equal(routesFor(b, b.tokens[0]).length, 6);
});
