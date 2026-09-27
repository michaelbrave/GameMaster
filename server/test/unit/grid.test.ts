import assert from "node:assert/strict";
import test from "node:test";
import { adjacent, gridSpaces, withinGrid } from "../../src/domain/grid";

test("large tiles have eight exits and diamonds have four reciprocal exits", () => {
  const spaces = gridSpaces(2, "square-diamond");
  for (const [at, count] of [
    [{ q: 0, r: 0 }, 8],
    [{ q: -1, r: -1 }, 4],
  ] as const) {
    const exits = spaces.filter((b) => adjacent(at, b, "square-diamond"));
    assert.equal(exits.length, count);
    assert.ok(exits.every((b) => adjacent(b, at, "square-diamond")));
  }
});
test("cardinal movement takes one step, diagonal takes two through a diamond", () => {
  assert.ok(adjacent({ q: 0, r: 0 }, { q: 2, r: 0 }, "square-diamond"));
  assert.ok(!adjacent({ q: 0, r: 0 }, { q: 2, r: 2 }, "square-diamond"));
  assert.ok(adjacent({ q: 0, r: 0 }, { q: 1, r: 1 }, "square-diamond"));
  assert.ok(adjacent({ q: 1, r: 1 }, { q: 2, r: 2 }, "square-diamond"));
  assert.ok(!adjacent({ q: 1, r: 1 }, { q: 3, r: 1 }, "square-diamond"));
});
test("finite square board excludes mixed parity, fractions and outer diamonds", () => {
  assert.equal(gridSpaces(2, "square-diamond").length, 41);
  for (const at of [
    { q: 0, r: 1 },
    { q: 0.5, r: 0.5 },
    { q: 5, r: 5 },
  ]) {
    assert.equal(withinGrid(at, 2, "square-diamond"), false);
  }
  assert.ok(withinGrid({ q: -4, r: 4 }, 2, "square-diamond"));
  assert.equal(gridSpaces(0, "square-diamond").length, 1);
  assert.equal(gridSpaces(2).length, 19);
  assert.equal(
    gridSpaces(2).filter((b) => adjacent({ q: 0, r: 0 }, b)).length,
    6,
  );
});
