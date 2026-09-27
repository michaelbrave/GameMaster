import type { Axial } from "../domain/axial";
import { key as hexKey } from "../domain/axial";
import type { TableDefinition } from "../domain/content";
import type { WorldEvent } from "../domain/events";
import {
  ConcurrencyError,
  DuplicateEventError,
  type DiscoveryRow,
  type EventQuery,
  type HexProjectionRow,
  type ResolutionRow,
  type SessionRow,
  type Store,
  type Tx,
  type WorldRow,
} from "./store";

interface MemoryState {
  worlds: Map<string, WorldRow>;
  sessions: Map<string, SessionRow>;
  events: WorldEvent[];
  resolutions: ResolutionRow[];
  hexes: Map<string, HexProjectionRow>;
  discoveries: DiscoveryRow[];
  tables: Map<string, TableDefinition>;
  seq: number;
}

const clone = <T>(value: T): T => structuredClone(value);

function snapshotState(s: MemoryState): MemoryState {
  return {
    worlds: new Map([...s.worlds].map(([k, v]) => [k, clone(v)])),
    sessions: new Map([...s.sessions].map(([k, v]) => [k, clone(v)])),
    events: clone(s.events),
    resolutions: clone(s.resolutions),
    hexes: new Map([...s.hexes].map(([k, v]) => [k, clone(v)])),
    discoveries: clone(s.discoveries),
    tables: new Map([...s.tables].map(([k, v]) => [k, clone(v)])),
    seq: s.seq,
  };
}

/**
 * In-memory Store used by tests and the documented `WORLDFORGE_STORE=memory`
 * development mode. It enforces the same invariants as the PostgreSQL store
 * (stream versions, optimistic concurrency, idempotency uniqueness) so
 * behavior is identical across adapters. Transactions roll back via
 * copy-on-write snapshots.
 */
export class MemoryStore implements Store {
  private state: MemoryState = {
    worlds: new Map(),
    sessions: new Map(),
    events: [],
    resolutions: [],
    hexes: new Map(),
    discoveries: [],
    tables: new Map(),
    seq: 0,
  };

  async withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const backup = snapshotState(this.state);
    try {
      return await fn(new MemoryTx(this.state));
    } catch (err) {
      this.state = backup;
      throw err;
    }
  }

  async close(): Promise<void> {
    // nothing to release
  }
}

class MemoryTx implements Tx {
  constructor(private readonly state: MemoryState) {}

  async insertWorld(row: WorldRow): Promise<void> {
    this.state.worlds.set(row.id, clone(row));
  }

  async getWorld(id: string): Promise<WorldRow | null> {
    const row = this.state.worlds.get(id);
    return row ? clone(row) : null;
  }

  async advanceWorldTick(
    id: string,
    newTick: number,
    expectedVersion: number,
  ): Promise<void> {
    const row = this.state.worlds.get(id);
    if (!row) throw new ConcurrencyError(`world ${id} not found`);
    if (row.version !== expectedVersion) {
      throw new ConcurrencyError(
        `world ${id} version ${row.version} != expected ${expectedVersion}`,
      );
    }
    row.currentTick = newTick;
    row.version += 1;
  }

  async insertSession(row: SessionRow): Promise<void> {
    this.state.sessions.set(row.id, clone(row));
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const row = this.state.sessions.get(id);
    return row ? clone(row) : null;
  }

  async updateSession(row: SessionRow, expectedVersion: number): Promise<void> {
    const existing = this.state.sessions.get(row.id);
    if (!existing) throw new ConcurrencyError(`session ${row.id} not found`);
    if (existing.version !== expectedVersion) {
      throw new ConcurrencyError(
        `session ${row.id} version ${existing.version} != expected ${expectedVersion}`,
      );
    }
    this.state.sessions.set(
      row.id,
      clone({ ...row, version: expectedVersion + 1 }),
    );
  }

  async appendEvents(events: WorldEvent[]): Promise<void> {
    const latest = new Map<string, number>();
    for (const e of this.state.events) {
      latest.set(
        e.streamId,
        Math.max(latest.get(e.streamId) ?? 0, e.streamVersion),
      );
    }
    for (const event of events) {
      const current = latest.get(event.streamId) ?? 0;
      if (event.streamVersion !== current + 1) {
        throw new DuplicateEventError(
          `stream ${event.streamId} expected version ${current + 1}, got ${event.streamVersion}`,
        );
      }
      latest.set(event.streamId, event.streamVersion);
      this.state.seq += 1;
      event.seq = this.state.seq;
      this.state.events.push(clone(event));
    }
  }

  /**
   * World events in seq order, with the same EventQuery semantics as the
   * PostgreSQL adapter (PgTx.eventsFilter). Keep the two in lockstep.
   */
  private filterWorldEvents(worldId: string, query?: EventQuery): WorldEvent[] {
    let list = this.state.events
      .filter((e) => e.worldId === worldId)
      .sort((a, b) => a.seq - b.seq);
    if (!query) return list;
    if (query.visibility) {
      list = list.filter((e) => e.visibility === query.visibility);
    }
    if (query.locations !== undefined) {
      const known = new Set(query.locations.map((l) => `${l.q},${l.r}`));
      const includeUnlocated = query.includeUnlocated ?? true;
      list = list.filter((e) => {
        if (!e.location) return includeUnlocated;
        return known.has(`${e.location.q},${e.location.r}`);
      });
    } else if (query.includeUnlocated === false) {
      list = list.filter((e) => e.location !== null);
    }
    return list;
  }

  async listEventsByWorld(
    worldId: string,
    query?: EventQuery,
  ): Promise<WorldEvent[]> {
    const filtered = this.filterWorldEvents(worldId, query);
    const offset = query?.offset ?? 0;
    const limit = query?.limit ?? filtered.length;
    return clone(filtered.slice(offset, offset + limit));
  }

  async countEventsByWorld(
    worldId: string,
    query?: Omit<EventQuery, "offset" | "limit">,
  ): Promise<number> {
    return this.filterWorldEvents(worldId, query).length;
  }

  async listEventsByStream(streamId: string): Promise<WorldEvent[]> {
    return clone(
      this.state.events
        .filter((e) => e.streamId === streamId)
        .sort((a, b) => a.seq - b.seq),
    );
  }

  async nextStreamVersion(streamId: string): Promise<number> {
    let max = 0;
    for (const e of this.state.events) {
      if (e.streamId === streamId) max = Math.max(max, e.streamVersion);
    }
    return max + 1;
  }

  async insertResolution(row: ResolutionRow): Promise<void> {
    const dupe = this.state.resolutions.find(
      (r) =>
        r.sessionId === row.sessionId &&
        r.idempotencyKey === row.idempotencyKey,
    );
    if (dupe) {
      throw new DuplicateEventError(
        `idempotency key "${row.idempotencyKey}" already used in session ${row.sessionId}`,
      );
    }
    this.state.resolutions.push(clone(row));
  }

  async getResolutionByKey(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<ResolutionRow | null> {
    const row = this.state.resolutions.find(
      (r) => r.sessionId === sessionId && r.idempotencyKey === idempotencyKey,
    );
    return row ? clone(row) : null;
  }

  async listResolutionsBySession(sessionId: string): Promise<ResolutionRow[]> {
    return clone(
      this.state.resolutions.filter((r) => r.sessionId === sessionId),
    );
  }

  async countResolutions(sessionId: string): Promise<number> {
    return this.state.resolutions.filter((r) => r.sessionId === sessionId)
      .length;
  }

  private hexId(worldId: string, at: Axial): string {
    return `${worldId}:${hexKey(at)}`;
  }

  async upsertHexProjection(row: HexProjectionRow): Promise<void> {
    this.state.hexes.set(this.hexId(row.worldId, row), clone(row));
  }

  async getHexProjection(
    worldId: string,
    at: Axial,
  ): Promise<HexProjectionRow | null> {
    const row = this.state.hexes.get(this.hexId(worldId, at));
    return row ? clone(row) : null;
  }

  async listHexProjections(worldId: string): Promise<HexProjectionRow[]> {
    return clone(
      [...this.state.hexes.values()].filter((h) => h.worldId === worldId),
    );
  }

  async insertDiscovery(row: DiscoveryRow): Promise<void> {
    const exists = this.state.discoveries.some(
      (d) => d.sessionId === row.sessionId && d.q === row.q && d.r === row.r,
    );
    if (!exists) this.state.discoveries.push(clone(row));
  }

  async listDiscoveries(sessionId: string): Promise<DiscoveryRow[]> {
    return clone(
      this.state.discoveries.filter((d) => d.sessionId === sessionId),
    );
  }

  async seedTable(def: TableDefinition): Promise<void> {
    this.state.tables.set(`${def.id}@${def.version}`, clone(def));
  }

  async getTable(id: string, version: number): Promise<TableDefinition | null> {
    const row = this.state.tables.get(`${id}@${version}`);
    return row ? clone(row) : null;
  }

  async latestTableVersion(id: string): Promise<number | null> {
    let latest: number | null = null;
    for (const t of this.state.tables.values()) {
      if (t.id === id) latest = Math.max(latest ?? 0, t.version);
    }
    return latest;
  }

  async listTables(): Promise<TableDefinition[]> {
    return clone([...this.state.tables.values()]);
  }
}
