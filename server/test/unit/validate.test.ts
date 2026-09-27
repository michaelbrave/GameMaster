import assert from "node:assert/strict";
import test from "node:test";
import { validateTableDefinition } from "../../src/domain/validate";
import { lookupFrom, table } from "./tables.test";

test("a well-formed weighted table validates clean", () => {
  const ok = table({
    id: "ok",
    entries: [{ id: "a", weight: 1, result: { text: "A" } }],
  });
  assert.deepEqual(validateTableDefinition(ok, lookupFrom([ok])), []);
});

test("invalid weights are reported", () => {
  const bad = table({
    id: "bw",
    entries: [{ id: "a", weight: 0, result: { text: "A" } }],
  });
  const problems = validateTableDefinition(bad, lookupFrom([bad]));
  assert.ok(problems.some((e) => e.path.includes("weight")));
});

test("dice tables must cover every possible total", () => {
  const bad = table({
    id: "bd",
    selection: { mode: "dice", dice: "2d6" },
    entries: [{ id: "a", range: [2, 6], result: { text: "A" } }],
  });
  const problems = validateTableDefinition(bad, lookupFrom([bad]));
  assert.ok(problems.some((e) => e.message.includes("not covered")));
});

test("dice ranges must stay within expression bounds", () => {
  const bad = table({
    id: "bd2",
    selection: { mode: "dice", dice: "d6" },
    entries: [{ id: "a", range: [1, 9], result: { text: "A" } }],
  });
  const problems = validateTableDefinition(bad, lookupFrom([bad]));
  assert.ok(problems.some((e) => e.message.includes("within dice bounds")));
});

test("unknown nested/choice references are reported", () => {
  const bad = table({
    id: "br",
    entries: [
      {
        id: "a",
        weight: 1,
        result: {
          text: "A",
          choices: [
            { id: "c", label: "go", table: { id: "ghost", version: 1 } },
          ],
        },
      },
    ],
  });
  const problems = validateTableDefinition(bad, lookupFrom([bad]));
  assert.ok(problems.some((e) => e.message.includes("unknown table")));
});

test("a declared presentation surface validates clean", () => {
  const target = table({
    id: "target",
    entries: [{ id: "a", weight: 1, result: { text: "A" } }],
  });
  const ok = table({
    id: "presentation-ok",
    entries: [
      {
        id: "a",
        weight: 1,
        result: {
          text: "A",
          choices: [
            {
              id: "charge",
              label: "Charge",
              table: { id: "target", version: 1 },
              presentation: "battlefield",
            },
          ],
        },
      },
    ],
  });
  assert.deepEqual(validateTableDefinition(ok, lookupFrom([ok, target])), []);
});

test("an unknown presentation surface is rejected, not silently ignored", () => {
  const target = table({
    id: "target",
    entries: [{ id: "a", weight: 1, result: { text: "A" } }],
  });
  const bad = table({
    id: "presentation-typo",
    entries: [
      {
        id: "a",
        weight: 1,
        result: {
          text: "A",
          choices: [
            {
              id: "charge",
              label: "Charge",
              table: { id: "target", version: 1 },
              // A typo must fail content load, not degrade to "resolve inline".
              presentation: "battlefeild" as never,
            },
          ],
        },
      },
    ],
  });
  const problems = validateTableDefinition(bad, lookupFrom([bad, target]));
  assert.ok(
    problems.some(
      (e) => e.path.endsWith("presentation") && e.message.includes("unknown"),
    ),
    `expected an unknown-presentation problem, got ${JSON.stringify(problems)}`,
  );
});
