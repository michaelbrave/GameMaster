/**
 * Content type vocabulary. Content is versioned text/JSON (see
 * contracts/json-schema) and never contains arbitrary executable code:
 * every behavior below is a closed, validated union.
 */

/** Reference to an exact immutable table version, e.g. { id: "core/bandit-fight", version: 1 }. */
export interface TableRef {
  id: string;
  version: number;
}

export function formatTableRef(ref: TableRef): string {
  return `${ref.id}@${ref.version}`;
}

/* ---------------------------------- effects --------------------------------- */

export interface FactPersistence {
  mode: "permanent" | "evolves";
  /** Evolution rule reference (format: "id@version") required when mode = "evolves". */
  procedure?: string;
}

export type Effect =
  | { type: "log"; text: string }
  | {
      type: "add_fact";
      category: string;
      tags?: string[];
      data?: Record<string, unknown>;
      persistence?: FactPersistence;
    }
  | {
      /** Transforms the fact this resolution is evaluating (fact evolution only). */
      type: "supersede_fact";
      category?: string;
      setTags?: string[];
      addTags?: string[];
      removeTags?: string[];
      data?: Record<string, unknown>;
      /** Persistence of the successor fact; defaults to the source fact's. */
      persistence?: FactPersistence;
    }
  | {
      type: "add_site";
      siteType: string;
      name: string;
      tags?: string[];
      asset?: string;
    };

/* ---------------------------------- choices --------------------------------- */

/**
 * Presentation surfaces a client may open for a choice. Declared in content so
 * clients never pattern-match authored choice ids: renaming a choice, or
 * authoring a new one that opens a surface, is a data change, not a code change.
 */
export const CHOICE_PRESENTATIONS = ["battlefield"] as const;

export type ChoicePresentation = (typeof CHOICE_PRESENTATIONS)[number];

export function isChoicePresentation(
  value: unknown,
): value is ChoicePresentation {
  return CHOICE_PRESENTATIONS.includes(value as ChoicePresentation);
}

export interface ChoiceDef {
  id: string;
  label: string;
  /** Nested table that resolves when the player picks this choice. */
  table: TableRef;
  /**
   * Presentation surface this choice opens, if any. Absent means the choice
   * resolves inline as text in the log. Purely presentational: the nested table
   * still resolves through the normal recorded trace either way.
   */
  presentation?: ChoicePresentation;
}

/* ------------------------------- table results ------------------------------ */

export interface TableResultPayload {
  /** Display text for the text log. */
  text: string;
  tags?: string[];
  effects?: Effect[];
  /** Authored options offered to the player; presence starts an encounter. */
  choices?: ChoiceDef[];
  /** Optional nested table resolved immediately as part of the same trace. */
  table?: TableRef;
  /** Optional referenced visual asset, e.g. "icon:bandits". Presentation only. */
  asset?: string;
  /**
   * Declared display label for `asset`. Display names are authored, never
   * derived by parsing the asset reference.
   */
  assetLabel?: string;
}

export interface TableEntry {
  id: string;
  /** Weighted selection mode: positive integer weight. */
  weight?: number;
  /** Dice selection mode: inclusive [min, max] total range. */
  range?: [number, number];
  /** Entries are eligible only when all conditions match the roll context. */
  conditions?: {
    requireTags?: string[];
    forbidTags?: string[];
  };
  result: TableResultPayload;
}

export interface TableDefinition {
  id: string;
  version: number;
  /** Machine purpose, e.g. "worldgen.terrain", "travel.encounter", "evolution.remains". */
  purpose: string;
  label: string;
  selection: { mode: "weighted" } | { mode: "dice"; dice: string };
  entries: TableEntry[];
  lifecycle?: "draft" | "published";
}

/* --------------------------------- terrain ---------------------------------- */

export interface TerrainDef {
  key: string;
  label: string;
  /** World ticks it costs to travel into this terrain. */
  moveCost: number;
  passable: boolean;
  /** Single-letter accessible glyph rendered inside the hex (not color-only). */
  glyph: string;
  /** Presentation hint for the client. */
  color: string;
}

/* --------------------------------- worldgen --------------------------------- */

export interface TerrainClusteringOverride {
  /** Exp-curve steepness; 0 leaves this terrain unclustered. */
  strength?: number;
  /** Coarse noise cell scale, in hexes (larger = bigger biome regions). */
  cellSize?: number;
  /** Blend of coarse cell hash vs per-hex hash, in [0, 1]. */
  cellBlend?: number;
}

export interface TerrainClusteringConfig {
  /**
   * Biome clustering: terrain-table weights are scaled by
   * exp(strength * (field - 0.5)) where field is coarse-cell value noise.
   * strength 0 disables clustering, reproducing the legacy independent
   * per-hex rolls.
   */
  strength: number;
  /** Coarse noise cell scale, in hexes (larger = bigger biome regions). */
  cellSize: number;
  /** Blend of coarse cell hash vs per-hex hash, in [0, 1]. */
  cellBlend: number;
  /** Per-terrain overrides (e.g. water forms larger bodies than plains). */
  perTerrain?: Record<string, TerrainClusteringOverride>;
}

export interface WorldgenConfig {
  /** Finite world: hex-shaped region of this radius around the origin. */
  regionRadius: number;
  /** Terrain of the origin/home hex (always materialized at world creation). */
  homeTerrain: string;
  terrainTable: TableRef;
  siteTable: TableRef;
  encounterTable: TableRef;
  /** Evolution rule references ("id@version") active in this world. */
  evolutionRules: string[];
  /** Optional biome clustering; omitted uses the engine default strength. */
  terrainClustering?: TerrainClusteringConfig;
}

/* --------------------------------- evolution -------------------------------- */

export interface EvolutionBand {
  /** Inclusive lower bound of elapsed world ticks since fact creation. */
  minElapsed: number;
  /** Exclusive upper bound; null means unbounded. */
  maxElapsed: number | null;
  table: TableRef;
}

export interface EvolutionRule {
  id: string;
  version: number;
  factCategory: string;
  bands: EvolutionBand[];
}
