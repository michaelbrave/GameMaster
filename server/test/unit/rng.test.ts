import assert from "node:assert/strict";
import test from "node:test";
import { deriveSeed, mulberry32, rngFromParts } from "../../src/domain/rng";

test("deriveSeed is deterministic and order-sensitive", () => {
  assert.equal(
    deriveSeed("world", 1, "hexgen"),
    deriveSeed("world", 1, "hexgen"),
  );
  assert.notEqual(deriveSeed("world", 1), deriveSeed("world", 2));
  assert.notEqual(deriveSeed("a", "b"), deriveSeed("b", "a"));
});

test("mulberry32 produces a repeatable stream", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = Array.from({ length: 100 }, () => a.nextFloat());
  const seqB = Array.from({ length: 100 }, () => b.nextFloat());
  assert.deepEqual(seqA, seqB);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test("nextInt stays within inclusive bounds", () => {
  const rng = rngFromParts("bounds-test");
  const seen = new Set<number>();
  for (let i = 0; i < 2000; i += 1) {
    const v = rng.nextInt(6);
    assert.ok(v >= 1 && v <= 6);
    seen.add(v);
  }
  assert.equal(
    seen.size,
    6,
    "expected all faces of a d6 to appear over 2000 rolls",
  );
  assert.throws(() => rng.nextInt(0));
});
