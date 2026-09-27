import type { EvolutionRule } from "./content";
import type { FactState } from "./events";

/**
 * Fact evolution is fact-first:
 *   fact category -> fact evolution procedure -> elapsed-time band
 *     -> nested outcome table -> new events.
 * This module is the pure band-selection half; resolution happens via
 * tables.resolveTable and application happens in the command services.
 */

export function evolutionRuleKey(rule: EvolutionRule): string {
  return `${rule.id}@${rule.version}`;
}

/**
 * Bands that are due for a fact at the current world tick and have not yet
 * been evaluated. Evaluating exactly once per (fact, band) is what makes
 * evolution idempotent for a source fact and evaluation window: bands are
 * recorded on the fact, and replays skip recorded bands.
 */
export function dueBands(
  rule: EvolutionRule,
  fact: FactState,
  worldTick: number,
): number[] {
  const elapsed = worldTick - fact.createdTick;
  const due: number[] = [];
  for (let i = 0; i < rule.bands.length; i += 1) {
    const band = rule.bands[i];
    const reached = elapsed >= band.minElapsed;
    if (reached && !fact.evaluatedBands.includes(i)) {
      due.push(i);
    }
  }
  return due;
}
