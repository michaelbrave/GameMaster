import { randomBytes } from "node:crypto";
import { materializeHex } from "../domain/hexgen";
import { deterministicId, newId } from "../domain/ids";
import type { CreatorPolicy, Store, WorldRow } from "../infrastructure/store";
import {
  hexStream,
  sessionStream,
  worldStream,
  type HexProjectionRow,
  type SessionRow,
} from "../infrastructure/store";
import { ApiError, notFound } from "./errors";
import { EventFactory, TableResolver, type Engine } from "./engine";

function randomSeed(): string {
  return randomBytes(6).toString("hex");
}

/**
 * Create a seeded finite world: the world row, its world_created event, and
 * the materialized home hex at the origin (fixed home terrain, sites rolled
 * deterministically from the world seed).
 */
export async function createWorld(
  store: Store,
  engine: Engine,
  input: {
    name: string;
    seed?: string;
    gridType?: import("../domain/grid").GridType;
  },
): Promise<WorldRow> {
  if (!input.name || typeof input.name !== "string") {
    throw new ApiError("validation_failed", "world name is required");
  }
  if (
    input.gridType !== undefined &&
    !["hex", "square-diamond"].includes(input.gridType)
  ) {
    throw new ApiError(
      "validation_failed",
      "gridType must be hex or square-diamond",
    );
  }
  const { pack } = engine;
  const world: WorldRow = {
    id: newId(),
    name: input.name,
    seed: input.seed ?? randomSeed(),
    contentRelease: pack.release,
    gridType: input.gridType ?? "hex",
    currentTick: 0,
    version: 0,
    createdAt: engine.now(),
  };
  await store.withTransaction(async (tx) => {
    await tx.insertWorld(world);
    const factory = new EventFactory(
      tx,
      {
        worldId: world.id,
        correlationId: world.id,
        actor: null,
        now: engine.now,
      },
      world.currentTick,
    );
    await factory.emit(worldStream(world.id), "world_created", "public", {
      name: world.name,
      gridType: world.gridType,
      contentRelease: world.contentRelease,
      regionRadius: pack.worldgen.regionRadius,
    });
    // Home hex: fixed home terrain; sites/facts rolled from the world seed.
    // Uses the same materialization path as every lazily generated hex, so the
    // recorded hex_materialized event is a complete, truthful snapshot.
    const origin = { q: 0, r: 0 };
    const resolver = new TableResolver(pack);
    await resolver.prime(tx);
    const result = materializeHex({
      gridType: world.gridType,
      worldSeed: world.seed,
      contentRelease: world.contentRelease,
      at: origin,
      worldgen: pack.worldgen,
      terrain: pack.terrain,
      lookup: resolver.lookup,
      newId: (kind, index) =>
        deterministicId(
          world.seed,
          world.contentRelease,
          "hexgen",
          origin.q,
          origin.r,
          kind,
          index,
        ),
      worldTick: world.currentTick,
      createdBy: world.id,
      forceTerrain: pack.worldgen.homeTerrain,
    });
    const hex: HexProjectionRow = {
      worldId: world.id,
      q: origin.q,
      r: origin.r,
      terrain: result.hex.terrain,
      tags: result.hex.tags,
      sites: result.hex.sites,
      facts: result.hex.facts,
      materializedTick: world.currentTick,
      version: 0,
    };
    await factory.emit(
      hexStream(world.id, origin),
      "hex_materialized",
      "system",
      {
        terrain: hex.terrain,
        tags: hex.tags,
        sites: hex.sites,
        facts: hex.facts,
        contentRelease: world.contentRelease,
        rolls: result.rolls,
      } as unknown as Record<string, unknown>,
      { location: origin },
    );
    hex.version = factory.countOn(hexStream(world.id, origin));
    await tx.upsertHexProjection(hex);
    await tx.appendEvents(factory.events);
  });
  return world;
}

/** Start a play session for the local solo player at the world origin. */
export async function createSession(
  store: Store,
  engine: Engine,
  input: {
    worldId: string;
    characterName: string;
    creatorPolicy?: Partial<CreatorPolicy>;
  },
): Promise<SessionRow> {
  if (!input.characterName)
    throw new ApiError("validation_failed", "characterName is required");
  const policy: CreatorPolicy = {
    tablePreview: input.creatorPolicy?.tablePreview ?? false,
    completeHistory: input.creatorPolicy?.completeHistory ?? false,
  };
  const session = await store.withTransaction(async (tx) => {
    const world = await tx.getWorld(input.worldId);
    if (!world) throw notFound(`world ${input.worldId}`);
    if (world.contentRelease !== engine.pack.release) {
      throw new ApiError(
        "content_version_missing",
        `world pins ${world.contentRelease}, but the loaded content release is ${engine.pack.release}`,
      );
    }
    const row: SessionRow = {
      id: newId(),
      worldId: world.id,
      characterName: input.characterName,
      q: 0,
      r: 0,
      status: "active",
      version: 0,
      creatorPolicy: policy,
      pendingEncounter: null,
      createdAt: engine.now(),
    };
    await tx.insertSession(row);
    const factory = new EventFactory(
      tx,
      {
        worldId: world.id,
        correlationId: row.id,
        actor: { type: "character", id: row.id },
        now: engine.now,
      },
      world.currentTick,
    );
    await factory.emit(sessionStream(row.id), "session_started", "public", {
      characterName: row.characterName,
      creatorPolicy: policy,
      createdAt: row.createdAt,
    });
    await factory.emit(
      hexStream(world.id, { q: 0, r: 0 }),
      "hex_discovered",
      "public",
      {
        terrain:
          (await tx.getHexProjection(world.id, { q: 0, r: 0 }))?.terrain ??
          packTerrain(engine),
      },
      { location: { q: 0, r: 0 } },
    );
    await tx.insertDiscovery({
      worldId: world.id,
      sessionId: row.id,
      q: 0,
      r: 0,
      tick: world.currentTick,
    });
    const home = await tx.getHexProjection(world.id, { q: 0, r: 0 });
    if (home) {
      home.version += factory.countOn(hexStream(world.id, home));
      await tx.upsertHexProjection(home);
    }
    await tx.appendEvents(factory.events);
    return row;
  });
  return session;
}

function packTerrain(engine: Engine): string {
  return engine.pack.worldgen.homeTerrain;
}
