import type { Axial } from "../domain/axial";
import type { Effect } from "../domain/content";
import type { FactState } from "../domain/events";
import { dueBands } from "../domain/evolution";
import { deterministicId, newId } from "../domain/ids";
import { rngFromParts } from "../domain/rng";
import { resolveTable, type RollRecord } from "../domain/tables";
import type { ContentPack } from "./content";
import {
  hexStream,
  type HexProjectionRow,
  type WorldRow,
} from "../infrastructure/store";
import { ApiError } from "./errors";
import type { EventFactory, TableResolver } from "./engine";

export interface EffectContext {
  world: WorldRow;
  at: Axial;
  /** Fact being evolved when effects come from an evolution table. */
  sourceFact?: FactState;
  /** Stable identity context for facts/sites produced by this effect batch. */
  identityParts?: Array<string | number>;
}

/**
 * Apply declarative table effects to a hex projection and emit the
 * corresponding public events. This is the only place effects are
 * interpreted; there is no arbitrary code in content.
 */
export async function applyEffects(
  effects: Effect[],
  hex: HexProjectionRow,
  ctx: EffectContext,
  factory: EventFactory,
): Promise<void> {
  const stream = hexStream(ctx.world.id, hex);
  for (let effectIndex = 0; effectIndex < effects.length; effectIndex += 1) {
    const effect = effects[effectIndex];
    const stableId = (kind: "site" | "fact"): string =>
      ctx.identityParts
        ? deterministicId(...ctx.identityParts, kind, effectIndex)
        : newId();
    switch (effect.type) {
      case "log":
        await factory.emit(
          stream,
          "log_appended",
          "public",
          { text: effect.text },
          { location: hex },
        );
        break;
      case "add_site": {
        const site = {
          id: stableId("site"),
          siteType: effect.siteType,
          name: effect.name,
          tags: effect.tags ?? [],
          ...(effect.asset ? { asset: effect.asset } : {}),
        };
        hex.sites.push(site);
        await factory.emit(
          stream,
          "site_added",
          "public",
          { site },
          { location: hex },
        );
        break;
      }
      case "add_fact": {
        const factId = stableId("fact");
        const factEvent = await factory.emit(
          stream,
          "fact_created",
          "public",
          {
            id: factId,
            category: effect.category,
            tags: effect.tags ?? [],
            data: effect.data ?? {},
            persistence: effect.persistence ?? { mode: "permanent" },
          },
          { location: hex },
        );
        hex.facts.push({
          id: factId,
          category: effect.category,
          tags: effect.tags ?? [],
          data: effect.data ?? {},
          status: "active",
          createdTick: factEvent.worldTick,
          createdBy: factEvent.id,
          evaluatedBands: [],
          persistence: effect.persistence ?? { mode: "permanent" },
        });
        break;
      }
      case "supersede_fact": {
        const source = ctx.sourceFact;
        if (!source) {
          throw new ApiError(
            "content_version_missing",
            "supersede_fact effect used outside fact evolution",
          );
        }
        const target = hex.facts.find(
          (f) => f.id === source.id && f.status === "active",
        );
        if (!target) break; // already superseded; stay idempotent
        const successor: FactState = {
          id: stableId("fact"),
          category: effect.category ?? target.category,
          tags: effect.setTags
            ? [...effect.setTags]
            : [
                ...target.tags.filter(
                  (t) => !(effect.removeTags ?? []).includes(t),
                ),
                ...(effect.addTags ?? []),
              ],
          data: { ...target.data, ...(effect.data ?? {}) },
          status: "active",
          createdTick: target.createdTick,
          createdBy: target.createdBy,
          evaluatedBands: [...target.evaluatedBands],
          persistence: effect.persistence ?? target.persistence,
        };
        target.status = "superseded";
        target.supersededBy = successor.id;
        await factory.emit(
          stream,
          "fact_superseded",
          "public",
          { factId: target.id, category: target.category, successor },
          { location: hex, causationId: target.createdBy },
        );
        hex.facts.push(successor);
        break;
      }
    }
  }
}

/**
 * Fact-first evolution: for each active evolving fact on the hex, evaluate
 * every due time band once (idempotent per fact+band) through its nested
 * outcome table, appending traceable linked events.
 */
export async function evaluateEvolution(
  pack: ContentPack,
  resolver: TableResolver,
  hex: HexProjectionRow,
  world: WorldRow,
  factory: EventFactory,
  rolls: RollRecord[],
): Promise<void> {
  const stream = hexStream(world.id, hex);
  for (const fact of hex.facts) {
    if (fact.status !== "active" || fact.persistence.mode !== "evolves")
      continue;
    const ruleKey = fact.persistence.procedure ?? "";
    const rule = pack.lookupEvolution(ruleKey);
    if (!rule) {
      throw new ApiError(
        "content_version_missing",
        `fact ${fact.id} references unknown evolution procedure "${ruleKey}"`,
      );
    }
    const due = dueBands(rule, fact, world.currentTick);
    for (const bandIndex of due) {
      const band = rule.bands[bandIndex];
      const rng = rngFromParts(
        world.seed,
        world.contentRelease,
        "evolution",
        fact.id,
        bandIndex,
      );
      const table = resolver.mustGet(band.table);
      const outcome = resolveTable(
        table,
        { tags: hex.tags },
        rng,
        resolver.lookup,
      );
      rolls.push(...outcome.rolls);
      fact.evaluatedBands.push(bandIndex);
      await factory.emit(
        stream,
        "evolution_evaluated",
        "system",
        {
          factId: fact.id,
          category: fact.category,
          rule: ruleKey,
          band: bandIndex,
          table: formatRef(band.table),
          rolls: outcome.rolls,
        },
        { location: hex, causationId: fact.createdBy },
      );
      for (const text of outcome.text) {
        await factory.emit(
          stream,
          "log_appended",
          "public",
          { text },
          { location: hex },
        );
      }
      await applyEffects(
        outcome.effects,
        hex,
        {
          world,
          at: hex,
          sourceFact: fact,
          identityParts: [
            world.seed,
            world.contentRelease,
            "evolution",
            fact.id,
            bandIndex,
          ],
        },
        factory,
      );
      if (fact.status !== "active") break; // superseded: later bands no longer apply
    }
  }
}

function formatRef(ref: { id: string; version: number }): string {
  return `${ref.id}@${ref.version}`;
}
