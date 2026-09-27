import type { Axial } from "../domain/axial";
import { formatTableRef, type TableRef } from "../domain/content";
import type { EventType, EventVisibility, WorldEvent } from "../domain/events";
import { materializeHex } from "../domain/hexgen";
import { deterministicId, newId } from "../domain/ids";
import type { RollRecord, TableLookup } from "../domain/tables";
import type { ContentPack } from "./content";
import {
  hexStream,
  type HexProjectionRow,
  type Tx,
  type WorldRow,
} from "../infrastructure/store";
import { ApiError } from "./errors";

/** Shared service context. */
export interface Engine {
  pack: ContentPack;
  now: () => string;
}

/** Refuse to run a world with a content pack other than the one it pinned. */
export function requirePinnedContent(world: WorldRow, engine: Engine): void {
  if (world.contentRelease !== engine.pack.release) {
    throw new ApiError(
      "content_version_missing",
      `world pins ${world.contentRelease}, but the loaded content release is ${engine.pack.release}`,
      {
        worldRelease: world.contentRelease,
        loadedRelease: engine.pack.release,
      },
    );
  }
}

/**
 * Synchronous table lookup for pure resolution paths, backed by a
 * preloaded map plus the content pack. Command handlers preload the tables
 * they need inside their transaction, so lookups stay deterministic.
 */
export class TableResolver {
  private cache = new Map<
    string,
    import("../domain/content").TableDefinition
  >();

  constructor(private readonly pack: ContentPack) {}

  async prime(tx: Tx): Promise<void> {
    for (const t of await tx.listTables())
      this.cache.set(`${t.id}@${t.version}`, t);
  }

  lookup: TableLookup = (ref) => {
    return (
      this.cache.get(`${ref.id}@${ref.version}`) ??
      this.pack.tables.find((t) => t.id === ref.id && t.version === ref.version)
    );
  };

  mustGet(ref: TableRef) {
    const t = this.lookup(ref);
    if (!t) {
      throw new ApiError(
        "content_version_missing",
        `table ${formatTableRef(ref)} is not available in content release ${this.pack.release}`,
      );
    }
    return t;
  }
}

/** Collects events for one command, assigning per-stream versions in order. */
export class EventFactory {
  readonly events: WorldEvent[] = [];
  private versions = new Map<string, number>();

  constructor(
    private readonly tx: Tx,
    private readonly opts: {
      worldId: string;
      correlationId: string;
      actor: { type: "character" | "engine"; id: string } | null;
      now: () => string;
    },
    private tick: number,
  ) {}

  setTick(tick: number): void {
    this.tick = tick;
  }

  /** The resolution id all events of this command correlate to. */
  get correlationId(): string {
    return this.opts.correlationId;
  }

  async emit(
    streamId: string,
    type: EventType,
    visibility: EventVisibility,
    payload: Record<string, unknown>,
    extra?: { location?: Axial | null; causationId?: string | null },
  ): Promise<WorldEvent> {
    let next = this.versions.get(streamId);
    if (next === undefined) {
      next = await this.tx.nextStreamVersion(streamId);
    }
    this.versions.set(streamId, next + 1);
    const event: WorldEvent = {
      id: newId(),
      worldId: this.opts.worldId,
      streamId,
      streamVersion: next,
      seq: 0, // assigned by the store at append time
      type,
      schemaVersion: 1,
      worldTick: this.tick,
      recordedAt: this.opts.now(),
      actor: this.opts.actor,
      // Normalize: the event location is exactly an axial coordinate, never a
      // richer row object (callers often pass a whole hex projection).
      location: extra?.location
        ? { q: extra.location.q, r: extra.location.r }
        : null,
      causationId: extra?.causationId ?? this.opts.correlationId,
      correlationId: this.opts.correlationId,
      visibility,
      payload,
    };
    this.events.push(event);
    return event;
  }

  /** Count of events emitted on one stream (used for projection versions). */
  countOn(streamId: string): number {
    return this.events.filter((e) => e.streamId === streamId).length;
  }
}

/** Ensure a hex projection exists, materializing deterministically if not. */
export async function ensureHexMaterialized(
  tx: Tx,
  engine: Engine,
  world: WorldRow,
  at: Axial,
  factory: EventFactory,
  rolls: RollRecord[],
): Promise<{ hex: HexProjectionRow; materializedNow: boolean }> {
  const existing = await tx.getHexProjection(world.id, at);
  if (existing) return { hex: existing, materializedNow: false };
  const result = materializeHex({
    gridType: world.gridType,
    worldSeed: world.seed,
    contentRelease: world.contentRelease,
    at,
    worldgen: engine.pack.worldgen,
    terrain: engine.pack.terrain,
    lookup: new TableResolver(engine.pack).lookup,
    newId: (kind, index) =>
      deterministicId(
        world.seed,
        world.contentRelease,
        "hexgen",
        at.q,
        at.r,
        kind,
        index,
      ),
    worldTick: world.currentTick,
    createdBy: factory.correlationId,
  });
  rolls.push(...result.rolls);
  const hex: HexProjectionRow = {
    worldId: world.id,
    q: at.q,
    r: at.r,
    terrain: result.hex.terrain,
    tags: result.hex.tags,
    sites: result.hex.sites,
    facts: result.hex.facts,
    materializedTick: world.currentTick,
    version: 0,
  };
  await factory.emit(
    hexStream(world.id, at),
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
    { location: at },
  );
  return { hex, materializedNow: true };
}
