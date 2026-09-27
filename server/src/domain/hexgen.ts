import type { Axial } from "./axial";
import { withinGrid, type GridType } from "./grid";
import type {
  Effect,
  TableDefinition,
  TableEntry,
  TerrainClusteringConfig,
  TerrainDef,
  WorldgenConfig,
} from "./content";
import type { FactState, SiteState } from "./events";
import type { RollContext, RollRecord, TableLookup } from "./tables";
import { resolveTable } from "./tables";
import { deriveSeed, rngFromParts } from "./rng";

export interface GeneratedHex {
  terrain: string;
  tags: string[];
  sites: SiteState[];
  facts: FactState[];
}

export interface MaterializationResult {
  hex: GeneratedHex;
  rolls: RollRecord[];
}

/* --------------------------- biome clustering --------------------------- */

/**
 * Terrain forms regions (lakes, mountain ranges, forests) via a
 * neighbor-correlated "probability layer": each terrain type has its own
 * blurred noise field over the axial plane, and a hex's terrain-table weights
 * are boosted by the local field strength before the usual weighted roll.
 *
 * The fields are pure hash functions of (worldSeed, contentRelease, terrain,
 * q, r) — they never consult generated neighbor state — so hexes still
 * materialize lazily, independently, and deterministically.
 */
/** Default clustering parameters when the content pack does not configure them. */
export const DEFAULT_CLUSTER_STRENGTH = 9;
export const DEFAULT_CLUSTER_CELL_SIZE = 2;
export const DEFAULT_CLUSTER_CELL_BLEND = 0.8;

/** Raw deterministic noise in [0, 1) for one terrain channel at one point. */
function biomeNoise(
  worldSeed: string,
  contentRelease: string,
  layer: string,
  terrain: string,
  q: number,
  r: number,
): number {
  return (
    deriveSeed(worldSeed, contentRelease, "biome", layer, terrain, q, r) /
    4294967296
  );
}

/** Round fractional axial coordinates to the nearest hex (cube rounding). */
function hexRoundAxial(qf: number, rf: number): Axial {
  const yf = -qf - rf;
  let rq = Math.round(qf);
  let ry = Math.round(yf);
  let rr = Math.round(rf);
  const dq = Math.abs(rq - qf);
  const dy = Math.abs(ry - yf);
  const dr = Math.abs(rr - rf);
  if (dq > dy && dq > dr) {
    rq = -ry - rr;
  } else if (dy > dr) {
    ry = -rq - rr;
  } else {
    rr = -rq - ry;
  }
  return { q: rq, r: rr };
}

/**
 * Coarse-cell value noise in [0, 1): the hex-plane is partitioned into coarse
 * cells (hex-rounding of scaled coordinates, ~cellSize² hexes each). A hex's
 * field blends its cell's hash with its own per-hex hash, so nearby hexes in
 * the same cell share most of the value — full-variance, spatially correlated
 * noise, which is what makes terrain form regions instead of confetti.
 */
export function biomeField(
  worldSeed: string,
  contentRelease: string,
  terrain: string,
  at: Axial,
  cellSize: number,
  cellBlend: number,
): number {
  const cell = hexRoundAxial(at.q / cellSize, at.r / cellSize);
  const coarse = biomeNoise(
    worldSeed,
    contentRelease,
    "cell",
    terrain,
    cell.q,
    cell.r,
  );
  const fine = biomeNoise(
    worldSeed,
    contentRelease,
    "fine",
    terrain,
    at.q,
    at.r,
  );
  return cellBlend * coarse + (1 - cellBlend) * fine;
}

function entryTerrainKey(entry: TableEntry): string | undefined {
  return entry.result.tags
    ?.find((t) => t.startsWith("terrain:"))
    ?.slice("terrain:".length);
}

/**
 * Return a copy of the terrain table whose entry weights are scaled by the
 * local biome field for their terrain:
 *   adjusted = max(1, round(base * exp(strength * (field - 0.5)))).
 * The exponential curve amplifies deviations from the field mean, so a hex
 * inside a "watery" noise cell is overwhelmingly water while a hex outside it
 * is unlikely to be — yielding lakes, ranges, and woods rather than isolated
 * tiles. The adjusted table still resolves through the normal recorded
 * weighted roll, so the resolution trace honestly reflects the clustered
 * probabilities. strength 0 leaves an entry unchanged (legacy behavior).
 */
export function clusterAdjustedTerrainTable(
  table: TableDefinition,
  worldSeed: string,
  contentRelease: string,
  at: Axial,
  clustering?: TerrainClusteringConfig,
): TableDefinition {
  return {
    ...table,
    entries: table.entries.map((entry) => {
      const terrain = entryTerrainKey(entry);
      if (!terrain || entry.weight === undefined) return entry;
      const override = clustering?.perTerrain?.[terrain];
      const strength =
        override?.strength ?? clustering?.strength ?? DEFAULT_CLUSTER_STRENGTH;
      if (strength <= 0) return entry;
      const cellSize =
        override?.cellSize ?? clustering?.cellSize ?? DEFAULT_CLUSTER_CELL_SIZE;
      const cellBlend =
        override?.cellBlend ??
        clustering?.cellBlend ??
        DEFAULT_CLUSTER_CELL_BLEND;
      const field = biomeField(
        worldSeed,
        contentRelease,
        terrain,
        at,
        cellSize,
        cellBlend,
      );
      const weight = Math.max(
        1,
        Math.round(entry.weight * Math.exp(strength * (field - 0.5))),
      );
      return { ...entry, weight };
    }),
  };
}

/**
 * Deterministically materialize a previously ungenerated hex from the world
 * seed and versioned generation content. Pure: the same (worldSeed,
 * contentRelease, q, r, content) always yields the same hex. The caller
 * persists the result; a materialized hex is never regenerated on revisits.
 */
export function materializeHex(params: {
  gridType?: GridType;
  worldSeed: string;
  contentRelease: string;
  at: Axial;
  worldgen: WorldgenConfig;
  terrain: Record<string, TerrainDef>;
  lookup: TableLookup;
  newId: (kind: "site" | "fact", index: number) => string;
  worldTick: number;
  createdBy: string;
  /**
   * Fix the terrain instead of rolling it (the world-creation home hex). No
   * terrain roll is recorded, because none happened.
   */
  forceTerrain?: string;
}): MaterializationResult {
  const {
    worldSeed,
    contentRelease,
    at,
    worldgen,
    lookup,
    newId,
    worldTick,
    createdBy,
    forceTerrain,
  } = params;
  if (!withinGrid(at, worldgen.regionRadius, params.gridType)) {
    throw new Error(
      `hex ${at.q},${at.r} is outside the finite world radius ${worldgen.regionRadius}`,
    );
  }
  if (forceTerrain && !params.terrain[forceTerrain]) {
    throw new Error(`forced terrain "${forceTerrain}" is not defined`);
  }
  const rng = rngFromParts(worldSeed, contentRelease, "hexgen", at.q, at.r);
  const rolls: RollRecord[] = [];

  // 1. Terrain, with biome clustering applied to the table weights.
  let terrainKey: string;
  if (forceTerrain) {
    terrainKey = forceTerrain;
  } else {
    const baseTerrainTable = lookup(worldgen.terrainTable);
    if (!baseTerrainTable)
      throw new Error(`missing terrain table ${worldgen.terrainTable.id}`);
    const terrainTable = clusterAdjustedTerrainTable(
      baseTerrainTable,
      worldSeed,
      contentRelease,
      at,
      worldgen.terrainClustering,
    );
    const terrainOutcome = resolveTable(
      terrainTable,
      { tags: [] },
      rng,
      lookup,
    );
    rolls.push(...terrainOutcome.rolls);
    terrainKey =
      terrainOutcome.results[0].tags
        ?.find((t) => t.startsWith("terrain:"))
        ?.slice("terrain:".length) ??
      terrainOutcome.results[0].text.toLowerCase();
    if (!params.terrain[terrainKey])
      throw new Error(`terrain table produced unknown terrain "${terrainKey}"`);
  }

  // 2. Sites / initial facts, conditioned on terrain.
  const ctx: RollContext = { tags: [`terrain:${terrainKey}`] };
  const siteTable = lookup(worldgen.siteTable);
  if (!siteTable)
    throw new Error(`missing site table ${worldgen.siteTable.id}`);
  const siteOutcome = resolveTable(siteTable, ctx, rng, lookup);
  rolls.push(...siteOutcome.rolls);

  const sites: SiteState[] = [];
  const facts: FactState[] = [];
  for (const effect of siteOutcome.effects) {
    applyMaterializationEffect(
      effect,
      { sites, facts },
      newId,
      worldTick,
      createdBy,
    );
  }

  return {
    hex: { terrain: terrainKey, tags: [`terrain:${terrainKey}`], sites, facts },
    rolls,
  };
}

function applyMaterializationEffect(
  effect: Effect,
  into: { sites: SiteState[]; facts: FactState[] },
  newId: (kind: "site" | "fact", index: number) => string,
  worldTick: number,
  createdBy: string,
): void {
  if (effect.type === "add_site") {
    into.sites.push({
      id: newId("site", into.sites.length),
      siteType: effect.siteType,
      name: effect.name,
      tags: effect.tags ?? [],
      ...(effect.asset ? { asset: effect.asset } : {}),
    });
  } else if (effect.type === "add_fact") {
    into.facts.push({
      id: newId("fact", into.facts.length),
      category: effect.category,
      tags: effect.tags ?? [],
      data: effect.data ?? {},
      status: "active",
      createdTick: worldTick,
      createdBy,
      evaluatedBands: [],
      persistence: effect.persistence ?? { mode: "permanent" },
    });
  }
  // "log" and "supersede_fact" effects are not meaningful during materialization.
}
