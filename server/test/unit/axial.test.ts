import assert from "node:assert/strict";
import test from "node:test";
import {
  DIRECTIONS,
  allHexes,
  distance,
  isNeighbor,
  isWithinRadius,
  key,
  neighbor,
  neighbors,
} from "../../src/domain/axial";

test("every neighbor is at distance 1 and directions are distinct", () => {
  const origin = { q: 0, r: 0 };
  const keys = new Set<string>();
  DIRECTIONS.forEach((_, i) => {
    const n = neighbor(origin, i);
    assert.equal(distance(origin, n), 1);
    keys.add(key(n));
  });
  assert.equal(keys.size, 6);
  assert.equal(neighbors(origin).length, 6);
});

test("hex distance matches cube-manhattan metric", () => {
  assert.equal(distance({ q: 0, r: 0 }, { q: 2, r: -1 }), 2);
  assert.equal(distance({ q: -2, r: 2 }, { q: 2, r: -2 }), 4);
  assert.ok(isNeighbor({ q: 1, r: 0 }, { q: 0, r: 0 }));
  assert.ok(!isNeighbor({ q: 2, r: 0 }, { q: 0, r: 0 }));
});

test("radius check implements the finite hex-shaped world", () => {
  assert.ok(isWithinRadius({ q: 2, r: -2 }, 2));
  assert.ok(!isWithinRadius({ q: 3, r: -3 }, 2));
  assert.ok(!isWithinRadius({ q: 2, r: 1 }, 2));
});

test("allHexes enumerates 3r(r+1)+1 hexes with the origin first", () => {
  assert.equal(allHexes(0).length, 1);
  assert.equal(allHexes(1).length, 7);
  assert.equal(allHexes(2).length, 19);
  assert.equal(allHexes(3).length, 37);
  const hexes = allHexes(2);
  assert.deepEqual(hexes[0], { q: 0, r: 0 });
  for (const h of hexes) assert.ok(isWithinRadius(h, 2));
  assert.equal(new Set(hexes.map(key)).size, hexes.length, "no duplicates");
});
