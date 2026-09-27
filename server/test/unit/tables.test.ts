import assert from "node:assert/strict";
import test from "node:test";
import type { TableDefinition, TableRef } from "../../src/domain/content";
import { rngFromParts } from "../../src/domain/rng";
import {
  TableResolutionError,
  eligibleEntries,
  resolveTable,
} from "../../src/domain/tables";

export function table(
  partial: Partial<TableDefinition> & Pick<TableDefinition, "id">,
): TableDefinition {
  return {
    version: 1,
    purpose: "test",
    label: partial.id,
    selection: { mode: "weighted" },
    entries: [],
    ...partial,
  };
}

export const lookupFrom =
  (defs: TableDefinition[]) =>
  (ref: TableRef): TableDefinition | undefined =>
    defs.find((d) => d.id === ref.id && d.version === ref.version);

test("weighted selection is deterministic and lands inside entries", () => {
  const t = table({
    id: "t",
    entries: [
      { id: "a", weight: 2, result: { text: "A" } },
      { id: "b", weight: 3, result: { text: "B" } },
    ],
  });
  const out1 = resolveTable(
    t,
    { tags: [] },
    rngFromParts("s1"),
    lookupFrom([t]),
  );
  const out2 = resolveTable(
    t,
    { tags: [] },
    rngFromParts("s1"),
    lookupFrom([t]),
  );
  assert.deepEqual(out1, out2);
  assert.equal(out1.rolls.length, 1);
  const roll = out1.rolls[0];
  assert.equal(roll.selection.mode, "weighted");
  if (roll.selection.mode === "weighted") {
    assert.ok(roll.selection.roll >= 1 && roll.selection.roll <= 5);
    assert.equal(roll.selection.totalWeight, 5);
  }
  assert.ok(["a", "b"].includes(roll.selectedEntryId));
});

test("conditions filter eligible entries", () => {
  const t = table({
    id: "t",
    entries: [
      {
        id: "forest-only",
        weight: 1,
        conditions: { requireTags: ["terrain:forest"] },
        result: { text: "F" },
      },
      { id: "any", weight: 1, result: { text: "X" } },
      {
        id: "no-swamp",
        weight: 1,
        conditions: { forbidTags: ["terrain:swamp"] },
        result: { text: "NS" },
      },
    ],
  });
  assert.deepEqual(
    eligibleEntries(t, { tags: ["terrain:forest"] }).map((e) => e.id),
    ["forest-only", "any", "no-swamp"],
  );
  assert.deepEqual(
    eligibleEntries(t, { tags: ["terrain:swamp"] }).map((e) => e.id),
    ["any"],
  );
});

test("nested tables resolve into the same trace with increasing depth", () => {
  const inner = table({
    id: "inner",
    entries: [{ id: "x", weight: 1, result: { text: "inner!" } }],
  });
  const outer = table({
    id: "outer",
    entries: [
      {
        id: "go",
        weight: 1,
        result: { text: "outer", table: { id: "inner", version: 1 } },
      },
    ],
  });
  const out = resolveTable(
    outer,
    { tags: [] },
    rngFromParts("n"),
    lookupFrom([inner, outer]),
  );
  assert.equal(out.rolls.length, 2);
  assert.deepEqual(
    out.rolls.map((r) => r.depth),
    [0, 1],
  );
  assert.deepEqual(out.text, ["outer", "inner!"]);
});

test("cycles and unknown references are rejected", () => {
  const selfRef = table({
    id: "loop",
    entries: [
      {
        id: "again",
        weight: 1,
        result: { text: "loop", table: { id: "loop", version: 1 } },
      },
    ],
  });
  assert.throws(
    () =>
      resolveTable(
        selfRef,
        { tags: [] },
        rngFromParts("c"),
        lookupFrom([selfRef]),
      ),
    (err: unknown) =>
      err instanceof TableResolutionError && err.code === "cycle_detected",
  );
  const missing = table({
    id: "m",
    entries: [
      {
        id: "go",
        weight: 1,
        result: { text: "m", table: { id: "nope", version: 1 } },
      },
    ],
  });
  assert.throws(
    () =>
      resolveTable(
        missing,
        { tags: [] },
        rngFromParts("c"),
        lookupFrom([missing]),
      ),
    (err: unknown) =>
      err instanceof TableResolutionError && err.code === "unknown_table",
  );
});

test("runaway nesting hits the max depth guard", () => {
  // a -> b -> c -> d -> e -> f: f would resolve at depth 5 > MAX_TABLE_DEPTH (4).
  const names = ["a", "b", "c", "d", "e", "f"];
  const defs = names.map((name, idx) =>
    table({
      id: name,
      entries: [
        {
          id: "go",
          weight: 1,
          result: {
            text: name,
            table: { id: names[idx + 1] ?? "zzz", version: 1 },
          },
        },
      ],
    }),
  );
  assert.throws(
    () =>
      resolveTable(defs[0], { tags: [] }, rngFromParts("d"), lookupFrom(defs)),
    (err: unknown) =>
      err instanceof TableResolutionError && err.code === "max_depth_exceeded",
  );
});

test("dice-mode selection rolls within the declared expression", () => {
  const t = table({
    id: "dicey",
    selection: { mode: "dice", dice: "2d6" },
    entries: [
      { id: "low", range: [2, 6], result: { text: "low" } },
      { id: "high", range: [7, 12], result: { text: "high" } },
    ],
  });
  for (const seed of ["x1", "x2", "x3", "x4", "x5"]) {
    const out = resolveTable(
      t,
      { tags: [] },
      rngFromParts(seed),
      lookupFrom([t]),
    );
    const sel = out.rolls[0].selection;
    assert.equal(sel.mode, "dice");
    if (sel.mode === "dice") {
      assert.equal(sel.dice.length, 2);
      assert.equal(sel.total, sel.dice[0] + sel.dice[1]);
      assert.ok(sel.total >= 2 && sel.total <= 12);
    }
  }
});
