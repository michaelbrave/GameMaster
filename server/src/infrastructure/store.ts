import type { Axial } from "../domain/axial";
import type { TableDefinition } from "../domain/content";
import type {
  FactState,
  PendingEncounter,
  SiteState,
  WorldEvent,
} from "../domain/events";
import type { RollRecord } from "../domain/tables";

/* --------------------------------- row types -------------------------------- */

export interface WorldRow {
  id: string;
  name: string;
  seed: string;
  contentRelease: string;
  gridType?: import("../domain/grid").GridType;
  currentTick: number;
  version: number;
  createdAt: string;
}

export interface CreatorPolicy {
  tablePreview: boolean;
  completeHistory: boolean;
}

export interface SessionRow {
  id: string;
  worldId: string;
  characterName: string;
  q: number;
  r: number;
  status: "active" | "ended";
  /** Optimistic-concurrency version; incremented once per applied command. */
  version: number;
  creatorPolicy: CreatorPolicy;
  pendingEncounter: PendingEncounter | null;
  createdAt: string;
}

export interface HexProjectionRow {
  worldId: string;
  q: number;
  r: number;
  terrain: string;
  tags: string[];
  sites: SiteState[];
  facts: FactState[];
  materializedTick: number;
  /** Number of hex-stream events folded into this projection. */
  version: number;
}

export interface DiscoveryRow {
  worldId: string;
  sessionId: string;
  q: number;
  r: number;
  tick: number;
}

export interface ResolutionRow {
  id: string;
  worldId: string;
  sessionId: string;
  commandType: "travel" | "encounter-action";
  /** Stable hash of the command payload, for idempotency-key reuse checks. */
  commandHash: string;
  seed: string;
  worldTick: number;
  rolls: RollRecord[];
  eventIds: string[];
  outcome: string;
  /** The exact API response returned for this command; replayed on retry. */
  response: unknown;
  idempotencyKey: string;
  createdAt: string;
}

/**
 * Optional filter/pagination for event history queries. Both store adapters
 * implement identical semantics; the application layer owns the visibility
 * rule and expresses it through these fields.
 */
export interface EventQuery {
  /** Restrict to one visibility class. */
  visibility?: WorldEvent["visibility"];
  /**
   * When set, located events must match one of these coordinates. Events
   * without a location are included iff `includeUnlocated` (default true).
   */
  locations?: Axial[];
  /** Include events with no location (default true). */
  includeUnlocated?: boolean;
  offset?: number;
  limit?: number;
}

/* --------------------------------- store port ------------------------------- */

export interface Tx {
  insertWorld(row: WorldRow): Promise<void>;
  getWorld(id: string): Promise<WorldRow | null>;
  /** Optimistic tick advance; rejects when expectedVersion does not match. */
  advanceWorldTick(
    id: string,
    newTick: number,
    expectedVersion: number,
  ): Promise<void>;

  insertSession(row: SessionRow): Promise<void>;
  getSession(id: string): Promise<SessionRow | null>;
  /** Optimistic session update; rejects when expectedVersion does not match. */
  updateSession(row: SessionRow, expectedVersion: number): Promise<void>;

  /** Append events atomically; stream versions must continue each stream. */
  appendEvents(events: WorldEvent[]): Promise<void>;
  /**
   * Events of a world in global seq order. Without a query returns all of
   * them; with one, filters and paginates in storage (adapters must not
   * stream the full history into memory to slice it).
   */
  listEventsByWorld(worldId: string, query?: EventQuery): Promise<WorldEvent[]>;
  /** Count of events matching the same filters (offset/limit ignored). */
  countEventsByWorld(
    worldId: string,
    query?: Omit<EventQuery, "offset" | "limit">,
  ): Promise<number>;
  listEventsByStream(streamId: string): Promise<WorldEvent[]>;
  nextStreamVersion(streamId: string): Promise<number>;

  insertResolution(row: ResolutionRow): Promise<void>;
  getResolutionByKey(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<ResolutionRow | null>;
  listResolutionsBySession(sessionId: string): Promise<ResolutionRow[]>;
  countResolutions(sessionId: string): Promise<number>;

  upsertHexProjection(row: HexProjectionRow): Promise<void>;
  getHexProjection(
    worldId: string,
    at: Axial,
  ): Promise<HexProjectionRow | null>;
  listHexProjections(worldId: string): Promise<HexProjectionRow[]>;

  insertDiscovery(row: DiscoveryRow): Promise<void>;
  listDiscoveries(sessionId: string): Promise<DiscoveryRow[]>;

  /** Immutable published table versions, seeded from the content pack. */
  seedTable(def: TableDefinition): Promise<void>;
  getTable(id: string, version: number): Promise<TableDefinition | null>;
  latestTableVersion(id: string): Promise<number | null>;
  listTables(): Promise<TableDefinition[]>;
}

export interface Store {
  /** Run fn inside one atomic transaction; rolls back on any throw. */
  withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyError";
  }
}

export class DuplicateEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateEventError";
  }
}

/* ------------------------------ stream helpers ------------------------------ */

export const worldStream = (worldId: string): string => `world:${worldId}`;
export const sessionStream = (sessionId: string): string =>
  `session:${sessionId}`;
export const hexStream = (worldId: string, at: Axial): string =>
  `hex:${worldId}:${at.q},${at.r}`;
