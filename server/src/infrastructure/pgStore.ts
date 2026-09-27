import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { Axial } from "../domain/axial";
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

/** PostgreSQL Store: the production persistence adapter. */
export class PgStore implements Store {
  readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new PgTx(client));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: string }).code === "23505";

class PgTx implements Tx {
  constructor(private readonly client: PoolClient) {}

  private async one<T extends QueryResultRow>(
    sql: string,
    params: unknown[],
  ): Promise<T | null> {
    const res = await this.client.query<T>(sql, params);
    return res.rows[0] ?? null;
  }

  private async many<T extends QueryResultRow>(
    sql: string,
    params: unknown[],
  ): Promise<T[]> {
    const res = await this.client.query<T>(sql, params);
    return res.rows;
  }

  async insertWorld(row: WorldRow): Promise<void> {
    await this.client.query(
      `INSERT INTO worlds (id, name, seed, content_release, current_tick, version, created_at, grid_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        row.id,
        row.name,
        row.seed,
        row.contentRelease,
        row.currentTick,
        row.version,
        row.createdAt,
        row.gridType ?? "hex",
      ],
    );
  }

  async getWorld(id: string): Promise<WorldRow | null> {
    const row = await this.one(
      `SELECT id, name, seed, content_release AS "contentRelease", current_tick AS "currentTick",
              version, created_at AS "createdAt", grid_type AS "gridType" FROM worlds WHERE id = $1`,
      [id],
    );
    return row as WorldRow | null;
  }

  async advanceWorldTick(
    id: string,
    newTick: number,
    expectedVersion: number,
  ): Promise<void> {
    const res = await this.client.query(
      `UPDATE worlds SET current_tick = $2, version = version + 1 WHERE id = $1 AND version = $3`,
      [id, newTick, expectedVersion],
    );
    if (res.rowCount !== 1) {
      throw new ConcurrencyError(
        `world ${id} version conflict (expected ${expectedVersion})`,
      );
    }
  }

  async insertSession(row: SessionRow): Promise<void> {
    await this.client.query(
      `INSERT INTO sessions (id, world_id, character_name, q, r, status, version, creator_policy, pending_encounter, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        row.id,
        row.worldId,
        row.characterName,
        row.q,
        row.r,
        row.status,
        row.version,
        JSON.stringify(row.creatorPolicy),
        row.pendingEncounter ? JSON.stringify(row.pendingEncounter) : null,
        row.createdAt,
      ],
    );
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const row = await this.one(
      `SELECT id, world_id AS "worldId", character_name AS "characterName", q, r, status, version,
              creator_policy AS "creatorPolicy", pending_encounter AS "pendingEncounter",
              created_at AS "createdAt"
       FROM sessions WHERE id = $1`,
      [id],
    );
    return row as SessionRow | null;
  }

  async updateSession(row: SessionRow, expectedVersion: number): Promise<void> {
    const res = await this.client.query(
      `UPDATE sessions SET q=$2, r=$3, status=$4, creator_policy=$5, pending_encounter=$6, version=version+1
       WHERE id=$1 AND version=$7`,
      [
        row.id,
        row.q,
        row.r,
        row.status,
        JSON.stringify(row.creatorPolicy),
        row.pendingEncounter ? JSON.stringify(row.pendingEncounter) : null,
        expectedVersion,
      ],
    );
    if (res.rowCount !== 1) {
      throw new ConcurrencyError(
        `session ${row.id} version conflict (expected ${expectedVersion})`,
      );
    }
  }

  async appendEvents(events: WorldEvent[]): Promise<void> {
    for (const e of events) {
      try {
        await this.client.query(
          `INSERT INTO events (id, world_id, stream_id, stream_version, type, schema_version,
                               world_tick, recorded_at, actor, location, causation_id,
                               correlation_id, visibility, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            e.id,
            e.worldId,
            e.streamId,
            e.streamVersion,
            e.type,
            e.schemaVersion,
            e.worldTick,
            e.recordedAt,
            e.actor ? JSON.stringify(e.actor) : null,
            e.location ? JSON.stringify(e.location) : null,
            e.causationId,
            e.correlationId,
            e.visibility,
            JSON.stringify(e.payload),
          ],
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new DuplicateEventError(
            `duplicate event on stream ${e.streamId} version ${e.streamVersion}`,
          );
        }
        throw err;
      }
    }
  }

  private async eventsWhere(
    clause: string,
    params: unknown[],
  ): Promise<WorldEvent[]> {
    const rows = await this.many(
      `SELECT id, world_id AS "worldId", stream_id AS "streamId", stream_version AS "streamVersion",
              seq::int, type, schema_version AS "schemaVersion", world_tick AS "worldTick",
              recorded_at AS "recordedAt", actor, location, causation_id AS "causationId",
              correlation_id AS "correlationId", visibility, payload
       FROM events ${clause}`,
      params,
    );
    return rows as unknown as WorldEvent[];
  }

  /**
   * Translate an EventQuery into a WHERE clause. Located events match by
   * their JSONB coordinates; unlocated events pass only when the query
   * includes them. Keep in lockstep with MemoryStore.filterWorldEvents.
   */
  private static eventsFilter(
    worldId: string,
    query?: EventQuery,
  ): { where: string; params: unknown[] } {
    const params: unknown[] = [worldId];
    const clauses = ["world_id = $1"];
    if (query?.visibility) {
      params.push(query.visibility);
      clauses.push(`visibility = $${params.length}`);
    }
    if (query?.locations !== undefined) {
      params.push(
        query.locations.map((l) => l.q),
        query.locations.map((l) => l.r),
      );
      const located = `((location->>'q')::int, (location->>'r')::int) IN (SELECT * FROM unnest($${params.length - 1}::int[], $${params.length}::int[]))`;
      clauses.push(
        (query.includeUnlocated ?? true)
          ? `(location IS NULL OR ${located})`
          : `(location IS NOT NULL AND ${located})`,
      );
    } else if (query && query.includeUnlocated === false) {
      clauses.push("location IS NOT NULL");
    }
    return { where: `WHERE ${clauses.join(" AND ")}`, params };
  }

  async listEventsByWorld(
    worldId: string,
    query?: EventQuery,
  ): Promise<WorldEvent[]> {
    const { where, params } = PgTx.eventsFilter(worldId, query);
    let paging = "";
    if (query?.offset !== undefined) {
      params.push(query.offset);
      paging += ` OFFSET $${params.length}`;
    }
    if (query?.limit !== undefined) {
      params.push(query.limit);
      paging += ` LIMIT $${params.length}`;
    }
    return this.eventsWhere(`${where} ORDER BY seq${paging}`, params);
  }

  async countEventsByWorld(
    worldId: string,
    query?: Omit<EventQuery, "offset" | "limit">,
  ): Promise<number> {
    const { where, params } = PgTx.eventsFilter(worldId, query);
    const row = await this.one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM events ${where}`,
      params,
    );
    return Number(row?.count ?? 0);
  }

  async listEventsByStream(streamId: string): Promise<WorldEvent[]> {
    return this.eventsWhere("WHERE stream_id = $1 ORDER BY seq", [streamId]);
  }

  async nextStreamVersion(streamId: string): Promise<number> {
    const row = await this.one<{ next: number }>(
      "SELECT COALESCE(MAX(stream_version), 0) + 1 AS next FROM events WHERE stream_id = $1",
      [streamId],
    );
    return Number(row?.next ?? 1);
  }

  async insertResolution(row: ResolutionRow): Promise<void> {
    try {
      await this.client.query(
        `INSERT INTO resolutions (id, world_id, session_id, command_type, command_hash, seed,
                                  world_tick, rolls, event_ids, outcome, response,
                                  idempotency_key, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          row.id,
          row.worldId,
          row.sessionId,
          row.commandType,
          row.commandHash,
          row.seed,
          row.worldTick,
          JSON.stringify(row.rolls),
          JSON.stringify(row.eventIds),
          row.outcome,
          JSON.stringify(row.response),
          row.idempotencyKey,
          row.createdAt,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DuplicateEventError(
          `idempotency key "${row.idempotencyKey}" already used in session ${row.sessionId}`,
        );
      }
      throw err;
    }
  }

  async getResolutionByKey(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<ResolutionRow | null> {
    const row = await this.one(
      `SELECT id, world_id AS "worldId", session_id AS "sessionId", command_type AS "commandType",
              command_hash AS "commandHash", seed, world_tick AS "worldTick", rolls,
              event_ids AS "eventIds", outcome, response, idempotency_key AS "idempotencyKey",
              created_at AS "createdAt"
       FROM resolutions WHERE session_id = $1 AND idempotency_key = $2`,
      [sessionId, idempotencyKey],
    );
    return row as ResolutionRow | null;
  }

  async listResolutionsBySession(sessionId: string): Promise<ResolutionRow[]> {
    const rows = await this.many(
      `SELECT id, world_id AS "worldId", session_id AS "sessionId", command_type AS "commandType",
              command_hash AS "commandHash", seed, world_tick AS "worldTick", rolls,
              event_ids AS "eventIds", outcome, response, idempotency_key AS "idempotencyKey",
              created_at AS "createdAt"
       FROM resolutions WHERE session_id = $1 ORDER BY created_at`,
      [sessionId],
    );
    return rows as unknown as ResolutionRow[];
  }

  async countResolutions(sessionId: string): Promise<number> {
    const row = await this.one<{ count: string }>(
      "SELECT COUNT(*)::int AS count FROM resolutions WHERE session_id = $1",
      [sessionId],
    );
    return Number(row?.count ?? 0);
  }

  async upsertHexProjection(row: HexProjectionRow): Promise<void> {
    await this.client.query(
      `INSERT INTO hex_projections (world_id, q, r, terrain, tags, sites, facts, materialized_tick, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (world_id, q, r) DO UPDATE SET
         terrain = EXCLUDED.terrain, tags = EXCLUDED.tags, sites = EXCLUDED.sites,
         facts = EXCLUDED.facts, materialized_tick = EXCLUDED.materialized_tick,
         version = EXCLUDED.version`,
      [
        row.worldId,
        row.q,
        row.r,
        row.terrain,
        JSON.stringify(row.tags),
        JSON.stringify(row.sites),
        JSON.stringify(row.facts),
        row.materializedTick,
        row.version,
      ],
    );
  }

  async getHexProjection(
    worldId: string,
    at: Axial,
  ): Promise<HexProjectionRow | null> {
    const row = await this.one(
      `SELECT world_id AS "worldId", q, r, terrain, tags, sites, facts,
              materialized_tick AS "materializedTick", version
       FROM hex_projections WHERE world_id = $1 AND q = $2 AND r = $3`,
      [worldId, at.q, at.r],
    );
    return row as HexProjectionRow | null;
  }

  async listHexProjections(worldId: string): Promise<HexProjectionRow[]> {
    const rows = await this.many(
      `SELECT world_id AS "worldId", q, r, terrain, tags, sites, facts,
              materialized_tick AS "materializedTick", version
       FROM hex_projections WHERE world_id = $1 ORDER BY r, q`,
      [worldId],
    );
    return rows as unknown as HexProjectionRow[];
  }

  async insertDiscovery(row: DiscoveryRow): Promise<void> {
    await this.client.query(
      `INSERT INTO discoveries (world_id, session_id, q, r, tick) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (session_id, q, r) DO NOTHING`,
      [row.worldId, row.sessionId, row.q, row.r, row.tick],
    );
  }

  async listDiscoveries(sessionId: string): Promise<DiscoveryRow[]> {
    const rows = await this.many(
      `SELECT world_id AS "worldId", session_id AS "sessionId", q, r, tick
       FROM discoveries WHERE session_id = $1 ORDER BY tick, r, q`,
      [sessionId],
    );
    return rows as unknown as DiscoveryRow[];
  }

  async seedTable(def: TableDefinition): Promise<void> {
    await this.client.query(
      `INSERT INTO content_tables (id, version, definition) VALUES ($1,$2,$3)
       ON CONFLICT (id, version) DO NOTHING`,
      [def.id, def.version, JSON.stringify(def)],
    );
  }

  async getTable(id: string, version: number): Promise<TableDefinition | null> {
    const row = await this.one<{ definition: TableDefinition }>(
      "SELECT definition FROM content_tables WHERE id = $1 AND version = $2",
      [id, version],
    );
    return row?.definition ?? null;
  }

  async latestTableVersion(id: string): Promise<number | null> {
    const row = await this.one<{ v: number | null }>(
      "SELECT MAX(version) AS v FROM content_tables WHERE id = $1",
      [id],
    );
    return row?.v ?? null;
  }

  async listTables(): Promise<TableDefinition[]> {
    const rows = await this.many<{ definition: TableDefinition }>(
      "SELECT definition FROM content_tables ORDER BY id, version",
      [],
    );
    return rows.map((r) => r.definition);
  }
}
