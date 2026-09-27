import type {
  ChoiceDef,
  Effect,
  TableDefinition,
  TableEntry,
  TableRef,
  TableResultPayload,
} from "./content";
import { formatTableRef } from "./content";
import { formatDice, parseDice, rollDice } from "./dice";
import type { Rng } from "./rng";

/** Context a table is rolled against; entry conditions match on these tags. */
export interface RollContext {
  tags: string[];
}

export type TableLookup = (ref: TableRef) => TableDefinition | undefined;

export class TableResolutionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unknown_table"
      | "no_eligible_entry"
      | "max_depth_exceeded"
      | "cycle_detected"
      | "invalid_table",
  ) {
    super(message);
    this.name = "TableResolutionError";
  }
}

export type RollSelectionRecord =
  | { mode: "weighted"; roll: number; totalWeight: number }
  | { mode: "dice"; expr: string; dice: number[]; total: number };

/** One resolved roll inside a resolution trace. Every random value is stored. */
export interface RollRecord {
  tableId: string;
  tableVersion: number;
  label: string;
  purpose: string;
  depth: number;
  selection: RollSelectionRecord;
  selectedEntryId: string;
  text: string;
}

export interface ResolutionOutcome {
  rolls: RollRecord[];
  /** Display texts of all selected results, in resolution order. */
  text: string[];
  /** Flattened effects of all selected results, in resolution order. */
  effects: Effect[];
  /** Choices offered by the last selected result that declared any. */
  choices: ChoiceDef[];
  /** Selected payloads in resolution order (top-level first). */
  results: TableResultPayload[];
}

/**
 * Maximum nesting depth, where the root table is depth 0. Depths 0..4 are
 * permitted, i.e. at most four nested hops below the root table.
 */
export const MAX_TABLE_DEPTH = 4;

export function eligibleEntries(
  table: TableDefinition,
  ctx: RollContext,
): TableEntry[] {
  return table.entries.filter((entry) => {
    const cond = entry.conditions;
    if (!cond) return true;
    if (
      cond.requireTags &&
      !cond.requireTags.every((t) => ctx.tags.includes(t))
    )
      return false;
    if (cond.forbidTags && cond.forbidTags.some((t) => ctx.tags.includes(t)))
      return false;
    return true;
  });
}

function selectWeighted(
  table: TableDefinition,
  entries: TableEntry[],
  rng: Rng,
): { entry: TableEntry; selection: RollSelectionRecord } {
  const totalWeight = entries.reduce((sum, e) => sum + (e.weight ?? 0), 0);
  if (totalWeight < 1) {
    throw new TableResolutionError(
      `Table ${table.id}@${table.version} has no positive weights among eligible entries`,
      "invalid_table",
    );
  }
  const roll = rng.nextInt(totalWeight);
  let cursor = 0;
  for (const entry of entries) {
    cursor += entry.weight ?? 0;
    if (roll <= cursor) {
      return { entry, selection: { mode: "weighted", roll, totalWeight } };
    }
  }
  throw new TableResolutionError(
    `Weighted roll ${roll} escaped table ${table.id}`,
    "invalid_table",
  );
}

function selectDice(
  table: TableDefinition,
  entries: TableEntry[],
  diceExpr: string,
  rng: Rng,
): { entry: TableEntry; selection: RollSelectionRecord } {
  const expr = parseDice(diceExpr);
  if (!expr) {
    throw new TableResolutionError(
      `Table ${table.id}@${table.version} has invalid dice expression "${diceExpr}"`,
      "invalid_table",
    );
  }
  const { total, rolls } = rollDice(expr, rng);
  const entry = entries.find(
    (e) => e.range && total >= e.range[0] && total <= e.range[1],
  );
  if (!entry) {
    throw new TableResolutionError(
      `Dice total ${total} matched no entry range on table ${table.id}@${table.version}`,
      "no_eligible_entry",
    );
  }
  return {
    entry,
    selection: { mode: "dice", expr: formatDice(expr), dice: rolls, total },
  };
}

/**
 * Resolve a table (plus any immediately nested `result.table` references) as a
 * pure function of (table versions, context, rng). All rolls are recorded so
 * the resolution can be replayed and audited. Nested selections belong to the
 * same trace; cycles and runaway depth are rejected.
 */
export function resolveTable(
  table: TableDefinition,
  ctx: RollContext,
  rng: Rng,
  lookup: TableLookup,
  depth = 0,
  chain: string[] = [],
  out: ResolutionOutcome = {
    rolls: [],
    text: [],
    effects: [],
    choices: [],
    results: [],
  },
): ResolutionOutcome {
  if (depth > MAX_TABLE_DEPTH) {
    throw new TableResolutionError(
      `Nested table resolution exceeded max depth ${MAX_TABLE_DEPTH} at ${table.id}`,
      "max_depth_exceeded",
    );
  }
  const refKey = formatTableRef(table);
  if (chain.includes(refKey)) {
    throw new TableResolutionError(
      `Nested table cycle detected: ${[...chain, refKey].join(" -> ")}`,
      "cycle_detected",
    );
  }
  const eligible = eligibleEntries(table, ctx);
  if (eligible.length === 0) {
    throw new TableResolutionError(
      `Table ${refKey} has no eligible entries for context tags [${ctx.tags.join(", ")}]`,
      "no_eligible_entry",
    );
  }
  const { entry, selection } =
    table.selection.mode === "weighted"
      ? selectWeighted(table, eligible, rng)
      : selectDice(table, eligible, table.selection.dice, rng);

  const result = entry.result;
  out.rolls.push({
    tableId: table.id,
    tableVersion: table.version,
    label: table.label,
    purpose: table.purpose,
    depth,
    selection,
    selectedEntryId: entry.id,
    text: result.text,
  });
  out.results.push(result);
  out.text.push(result.text);
  if (result.effects) out.effects.push(...result.effects);
  if (result.choices && result.choices.length > 0) out.choices = result.choices;

  if (result.table) {
    const nested = lookup(result.table);
    if (!nested) {
      throw new TableResolutionError(
        `Table ${refKey} references unknown nested table ${formatTableRef(result.table)}`,
        "unknown_table",
      );
    }
    resolveTable(nested, ctx, rng, lookup, depth + 1, [...chain, refKey], out);
  }
  return out;
}
