import assert from "node:assert/strict";
import test from "node:test";
import { allHexes } from "../../src/domain/axial";
import type {
  TableDefinition,
  TerrainClusteringConfig,
  TerrainDef,
  WorldgenConfig,
} from "../../src/domain/content";
import { materializeHex } from "../../src/domain/hexgen";
import { rngFromParts } from "../../src/domain/rng";
import type { TableLookup } from "../../src/domain/tables";
import { resolveTable } from "../../src/domain/tables";

const TERRAINS = ["plains", "forest", "hills", "water"];

const terrainTable: TableDefinition = {
  id: "test/terrain",
  version: 1,
  purpose: "worldgen.terrain",
  label: "Terrain",
  selection: { mode: "weighted" },
  entries: TERRAINS.map((k) => ({
    id: k,
    weight: 10,
    result: { text: k, tags: [`terrain:${k}`] },
  })),
};

const siteTable: TableDefinition = {
  id: "test/sites",
  version: 1,
  purpose: "worldgen.sites",
  label: "Sites",
  selection: { mode: "weighted" },
  entries: [{ id: "quiet", weight: 1, result: { text: "Quiet." } }],
};

const worldgen: WorldgenConfig = {
  regionRadius: 3,
  homeTerrain: "plains",
  terrainTable: { id: "test/terrain", version: 1 },
  siteTable: { id: "test/sites", version: 1 },
  encounterTable: { id: "test/sites", version: 1 },
  evolutionRules: [],
};

const terrainDefs: Record<string, TerrainDef> = Object.fromEntries(
  TERRAINS.map((k) => [
    k,
    {
      key: k,
      label: k,
      moveCost: 1,
      passable: true,
      glyph: "?",
      color: "#000",
    },
  ]),
);

const tablesByRef: Record<string, TableDefinition> = {
  "test/terrain@1": terrainTable,
  "test/sites@1": siteTable,
};

const lookup: TableLookup = (ref) => tablesByRef[`${ref.id}@${ref.version}`];

function materializeTerrain(
  seed: string,
  at: { q: number; r: number },
  terrainClustering?: TerrainClusteringConfig,
): string {
  let id = 0;
  return materializeHex({
    worldSeed: seed,
    contentRelease: "test@1",
    at,
    worldgen: { ...worldgen, terrainClustering },
    terrain: terrainDefs,
    lookup,
    newId: () => `id-${(id += 1)}`,
    worldTick: 0,
    createdBy: "test",
  }).hex.terrain;
}

/** Fraction of adjacent hex pairs sharing a terrain (blobbiness measure). */
function sameTerrainAdjacency(
  seeds: string[],
  terrainClustering?: TerrainClusteringConfig,
): number {
  let same = 0;
  let total = 0;
  for (const seed of seeds) {
    const map = new Map<string, string>();
    for (const at of allHexes(worldgen.regionRadius)) {
      map.set(
        `${at.q},${at.r}`,
        materializeTerrain(seed, at, terrainClustering),
      );
    }
    for (const [k, t] of map) {
      const [q, r] = k.split(",").map(Number);
      for (const d of [
        { q: 1, r: 0 },
        { q: -1, r: 1 },
        { q: 0, r: 1 },
      ]) {
        const n = map.get(`${q + d.q},${r + d.r}`);
        if (n === undefined) continue;
        total += 1;
        if (n === t) same += 1;
      }
    }
  }
  return same / total;
}

test("materializeHex is deterministic for the same inputs", () => {
  let id = 0;
  const run = () =>
    materializeHex({
      worldSeed: "seed-a",
      contentRelease: "test@1",
      at: { q: 1, r: -1 },
      worldgen,
      terrain: terrainDefs,
      lookup,
      newId: () => `id-${(id += 1)}`,
      worldTick: 0,
      createdBy: "test",
    });
  id = 0;
  const a = run();
  id = 0;
  const b = run();
  assert.deepEqual(a, b);
});

test("clustering strength 0 reproduces the legacy independent roll", () => {
  const at = { q: 2, r: -1 };
  const rng = rngFromParts("seed-a", "test@1", "hexgen", at.q, at.r);
  const direct = resolveTable(terrainTable, { tags: [] }, rng, lookup);
  const legacyKey = direct.results[0].tags
    ?.find((t) => t.startsWith("terrain:"))
    ?.slice("terrain:".length);
  assert.equal(
    materializeTerrain("seed-a", at, {
      strength: 0,
      cellSize: 2,
      cellBlend: 0.8,
    }),
    legacyKey,
  );
});

test("biome clustering correlates neighboring terrain", () => {
  const seeds = ["demo-16", "alpha", "beta", "gamma", "delta", "epsilon"];
  const independent = sameTerrainAdjacency(seeds, {
    strength: 0,
    cellSize: 2,
    cellBlend: 0.8,
  });
  const clustered = sameTerrainAdjacency(seeds, {
    strength: 9,
    cellSize: 2,
    cellBlend: 0.8,
  });
  assert.ok(
    clustered > independent + 0.1,
    `expected clustered adjacency ${clustered.toFixed(2)} to beat independent ${independent.toFixed(2)} by a clear margin`,
  );
});

test("clustered weights stay positive integers (recorded roll stays valid)", () => {
  // Every hex in the region must materialize without escaping the table,
  // across a spread of cluster configurations.
  for (const cellSize of [1, 2, 4]) {
    for (const at of allHexes(worldgen.regionRadius)) {
      const terrain = materializeTerrain("seed-c", at, {
        strength: 12,
        cellSize,
        cellBlend: 0.8,
      });
      assert.ok(TERRAINS.includes(terrain));
    }
  }
});
