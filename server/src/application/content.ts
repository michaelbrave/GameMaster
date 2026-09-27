import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  EvolutionRule,
  TableDefinition,
  TerrainDef,
  WorldgenConfig,
} from "../domain/content";
import { evolutionRuleKey } from "../domain/evolution";
import type { TableLookup } from "../domain/tables";
import { validateTableDefinition } from "../domain/validate";

export interface ContentPack {
  /** Release identity, e.g. "core@1.0.0". Worlds pin this exact string. */
  release: string;
  id: string;
  version: string;
  terrain: Record<string, TerrainDef>;
  worldgen: WorldgenConfig;
  tables: TableDefinition[];
  evolutions: EvolutionRule[];
  lookupTable: TableLookup;
  lookupEvolution: (key: string) => EvolutionRule | undefined;
}

interface Manifest {
  id: string;
  version: string;
  terrain: string;
  worldgen: string;
  tables: string[];
  evolutions: string[];
}

function readJson<T>(dir: string, file: string): T {
  return JSON.parse(readFileSync(join(dir, file), "utf8")) as T;
}

/**
 * Load and fully validate a versioned content pack directory. The loader is
 * generic: it validates structure and reference integrity but contains no
 * game-specific branches.
 */
export function loadContentPack(dir: string): ContentPack {
  const manifest = readJson<Manifest>(dir, "manifest.json");
  const terrain = readJson<Record<string, TerrainDef>>(dir, manifest.terrain);
  const worldgen = readJson<WorldgenConfig>(dir, manifest.worldgen);
  const tables = manifest.tables.map((f) => readJson<TableDefinition>(dir, f));
  const evolutions = manifest.evolutions.map((f) =>
    readJson<EvolutionRule>(dir, f),
  );

  const problems: string[] = [];
  const byRef = new Map<string, TableDefinition>();
  for (const t of tables) {
    const ref = `${t.id}@${t.version}`;
    if (byRef.has(ref)) problems.push(`duplicate table ${ref}`);
    byRef.set(ref, t);
  }
  const lookupTable: TableLookup = (ref) =>
    byRef.get(`${ref.id}@${ref.version}`);

  for (const t of tables) {
    for (const p of validateTableDefinition(t, lookupTable)) {
      problems.push(`${t.id}@${t.version}: ${p.path}: ${p.message}`);
    }
  }

  // Terrain table results must name known terrains.
  for (const t of tables) {
    if (t.purpose === "worldgen.terrain") {
      for (const entry of t.entries) {
        const key = entry.result.tags
          ?.find((x) => x.startsWith("terrain:"))
          ?.slice(8);
        if (!key || !terrain[key])
          problems.push(
            `${t.id}: entry ${entry.id} maps to unknown terrain "${key}"`,
          );
      }
    }
  }

  // Evolution rules: bands ordered, non-overlapping, tables resolve.
  const evoByKey = new Map<string, EvolutionRule>();
  for (const rule of evolutions) {
    evoByKey.set(evolutionRuleKey(rule), rule);
    let prevMax = 0;
    rule.bands.forEach((band, i) => {
      if (band.minElapsed !== prevMax) {
        problems.push(
          `${rule.id}: band ${i} starts at ${band.minElapsed}, expected ${prevMax} (bands must be contiguous)`,
        );
      }
      if (band.maxElapsed !== null && band.maxElapsed <= band.minElapsed) {
        problems.push(`${rule.id}: band ${i} has maxElapsed <= minElapsed`);
      }
      prevMax = band.maxElapsed ?? Number.POSITIVE_INFINITY;
      if (!lookupTable(band.table)) {
        problems.push(
          `${rule.id}: band ${i} references unknown table ${band.table.id}@${band.table.version}`,
        );
      }
    });
  }
  for (const refKey of worldgen.evolutionRules) {
    if (!evoByKey.has(refKey))
      problems.push(`worldgen references unknown evolution rule ${refKey}`);
  }
  for (const ref of [
    worldgen.terrainTable,
    worldgen.siteTable,
    worldgen.encounterTable,
  ]) {
    if (!lookupTable(ref))
      problems.push(
        `worldgen references unknown table ${ref.id}@${ref.version}`,
      );
  }
  if (!terrain[worldgen.homeTerrain])
    problems.push(`unknown homeTerrain "${worldgen.homeTerrain}"`);
  if (!terrain[worldgen.homeTerrain]?.passable)
    problems.push("homeTerrain must be passable");

  const clustering = worldgen.terrainClustering;
  if (clustering) {
    const checkParams = (
      where: string,
      p: { strength?: number; cellSize?: number; cellBlend?: number },
    ) => {
      if (p.strength !== undefined && !(p.strength >= 0))
        problems.push(`${where}.strength must be a non-negative number`);
      if (
        p.cellSize !== undefined &&
        (!Number.isInteger(p.cellSize) || p.cellSize < 1)
      )
        problems.push(`${where}.cellSize must be an integer >= 1`);
      if (p.cellBlend !== undefined && !(p.cellBlend >= 0 && p.cellBlend <= 1))
        problems.push(`${where}.cellBlend must be within [0, 1]`);
    };
    checkParams("worldgen.terrainClustering", clustering);
    for (const [key, override] of Object.entries(clustering.perTerrain ?? {})) {
      if (!terrain[key])
        problems.push(
          `worldgen.terrainClustering.perTerrain references unknown terrain "${key}"`,
        );
      checkParams(`worldgen.terrainClustering.perTerrain.${key}`, override);
    }
  }

  // Facts produced anywhere in the pack may only declare known evolution procedures.
  for (const t of tables) {
    for (const entry of t.entries) {
      for (const effect of entry.result.effects ?? []) {
        if (
          effect.type === "add_fact" &&
          effect.persistence?.mode === "evolves"
        ) {
          const proc = effect.persistence.procedure ?? "";
          if (!evoByKey.has(proc)) {
            problems.push(
              `${t.id}/${entry.id}: unknown evolution procedure "${proc}"`,
            );
          }
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Content pack at ${dir} failed validation:\n - ${problems.join("\n - ")}`,
    );
  }

  return {
    release: `${manifest.id}@${manifest.version}`,
    id: manifest.id,
    version: manifest.version,
    terrain,
    worldgen,
    tables,
    evolutions,
    lookupTable,
    lookupEvolution: (key) => evoByKey.get(key),
  };
}
