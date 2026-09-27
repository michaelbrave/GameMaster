import {
  isChoicePresentation,
  type TableDefinition,
  type TableRef,
} from "./content";
import { maxRoll, minRoll, parseDice } from "./dice";
import type { TableLookup } from "./tables";

export interface ValidationProblem {
  path: string;
  message: string;
}

/**
 * Static validation for table drafts: shared by the content loader and the
 * /tables/validate endpoint. Checks selection-mode internal consistency and
 * nested-reference integrity (choices and immediate nested tables).
 */
export function validateTableDefinition(
  def: TableDefinition,
  lookup: TableLookup,
): ValidationProblem[] {
  const errors: ValidationProblem[] = [];
  if (!def || typeof def !== "object") {
    return [{ path: "", message: "table definition must be an object" }];
  }
  if (!def.id || typeof def.id !== "string")
    errors.push({ path: "id", message: "id is required" });
  if (!Number.isInteger(def.version) || def.version < 1)
    errors.push({
      path: "version",
      message: "version must be an integer >= 1",
    });
  if (!Array.isArray(def.entries) || def.entries.length === 0)
    errors.push({ path: "entries", message: "at least one entry is required" });

  const entries = Array.isArray(def.entries) ? def.entries : [];

  if (def.selection?.mode === "dice") {
    const expr = parseDice(def.selection.dice);
    if (!expr) {
      errors.push({
        path: "selection.dice",
        message: `invalid bounded dice expression "${def.selection.dice}"`,
      });
    } else {
      const lo = minRoll(expr);
      const hi = maxRoll(expr);
      const ranges: Array<[number, number]> = [];
      entries.forEach((entry, i) => {
        if (!entry.range) {
          errors.push({
            path: `entries[${i}].range`,
            message:
              "dice-mode tables require an inclusive [min,max] range on every entry",
          });
          return;
        }
        const [a, b] = entry.range;
        if (a < lo || b > hi || a > b) {
          errors.push({
            path: `entries[${i}].range`,
            message: `range [${a},${b}] must be valid and within dice bounds [${lo},${hi}]`,
          });
        }
        ranges.push([a, b]);
      });
      const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
      for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i][0] <= sorted[i - 1][1]) {
          errors.push({
            path: "entries",
            message: `overlapping dice ranges [${sorted[i - 1]}] and [${sorted[i]}]`,
          });
        }
      }
      for (let v = lo; v <= hi; v += 1) {
        if (!sorted.some(([a, b]) => v >= a && v <= b)) {
          errors.push({
            path: "entries",
            message: `dice total ${v} is not covered by any entry range`,
          });
          break;
        }
      }
    }
  } else if (def.selection?.mode === "weighted") {
    entries.forEach((entry, i) => {
      if (!Number.isInteger(entry.weight) || (entry.weight as number) < 1) {
        errors.push({
          path: `entries[${i}].weight`,
          message: "weighted-mode entries require an integer weight >= 1",
        });
      }
    });
  } else {
    errors.push({
      path: "selection.mode",
      message: 'selection.mode must be "weighted" or "dice"',
    });
  }

  // Reference integrity: nested tables and choice tables must resolve.
  entries.forEach((entry, i) => {
    const refs: Array<{ ref: TableRef | undefined; path: string }> = [
      { ref: entry.result?.table, path: `entries[${i}].result.table` },
      ...(entry.result?.choices ?? []).map((choice, j) => ({
        ref: choice.table,
        path: `entries[${i}].result.choices[${j}].table`,
      })),
    ];
    for (const { ref, path } of refs) {
      if (!ref) continue;
      if (!lookup(ref)) {
        errors.push({
          path,
          message: `references unknown table ${ref.id}@${ref.version}`,
        });
      }
    }

    // Presentation surfaces are a closed vocabulary. A typo here would otherwise
    // silently degrade to "resolve inline" and only surface as a missing
    // feature in a client.
    (entry.result?.choices ?? []).forEach((choice, j) => {
      if (
        choice.presentation !== undefined &&
        !isChoicePresentation(choice.presentation)
      ) {
        errors.push({
          path: `entries[${i}].result.choices[${j}].presentation`,
          message: `unknown presentation surface ${JSON.stringify(choice.presentation)}`,
        });
      }
    });
  });
  return errors;
}
