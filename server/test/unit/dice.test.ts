import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDice,
  maxRoll,
  minRoll,
  parseDice,
  rollDice,
} from "../../src/domain/dice";
import { rngFromParts } from "../../src/domain/rng";

test("parses supported bounded dice expressions", () => {
  assert.deepEqual(parseDice("d6"), { count: 1, sides: 6, modifier: 0 });
  assert.deepEqual(parseDice("2d6"), { count: 2, sides: 6, modifier: 0 });
  assert.deepEqual(parseDice("2d6+1"), { count: 2, sides: 6, modifier: 1 });
  assert.deepEqual(parseDice("1d20-2"), { count: 1, sides: 20, modifier: -2 });
});

test("rejects malformed or unbounded expressions", () => {
  for (const bad of [
    "",
    "d",
    "d1",
    "0d6",
    "11d6",
    "2d1001",
    "2d6+101",
    "2d6+1x",
    "2D6 ",
    "e2d6",
  ]) {
    assert.equal(parseDice(bad), null, `expected "${bad}" to be rejected`);
  }
});

test("min/max bounds include the modifier", () => {
  const e = parseDice("2d6+1");
  assert.ok(e);
  assert.equal(minRoll(e), 3);
  assert.equal(maxRoll(e), 13);
});

test("rolls are deterministic and within bounds", () => {
  const expr = parseDice("2d6+1");
  assert.ok(expr);
  const a = rollDice(expr, rngFromParts("same-seed"));
  const b = rollDice(expr, rngFromParts("same-seed"));
  assert.deepEqual(a, b);
  assert.equal(a.rolls.length, 2);
  assert.ok(a.total >= minRoll(expr) && a.total <= maxRoll(expr));
});

test("formatDice round-trips through parseDice", () => {
  for (const s of ["d6", "2d6", "2d6+1", "3d8-2"]) {
    const parsed = parseDice(s);
    assert.ok(parsed);
    assert.deepEqual(parseDice(formatDice(parsed)), parsed);
  }
});
