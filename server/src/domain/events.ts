import type { Axial } from "./axial";
import type { ChoiceDef } from "./content";
import type { RollRecord } from "./tables";

/**
 * Append-only domain events. An old event is never rewritten; when a fact
 * evolves, a new linked event is appended (causationId points at the cause).
 */
export type EventType =
  | "battlefield_updated"
  | "world_created"
  | "session_started"
  | "hex_materialized"
  | "hex_discovered"
  | "character_moved"
  | "travel_blocked"
  | "time_advanced"
  | "encounter_started"
  | "encounter_resolved"
  | "site_added"
  | "fact_created"
  | "fact_superseded"
  | "evolution_evaluated"
  | "log_appended";

export type EventVisibility = "public" | "system";

export interface EventActor {
  type: "character" | "engine";
  id: string;
}

export interface WorldEvent<TPayload = Record<string, unknown>> {
  id: string;
  worldId: string;
  /** Owning stream, e.g. "world:<id>", "session:<id>", "hex:<worldId>:<q>,<r>". */
  streamId: string;
  /** Strictly increasing version within the stream, starting at 1. */
  streamVersion: number;
  /** Global monotonic sequence assigned by the store at append time. */
  seq: number;
  type: EventType;
  schemaVersion: 1;
  worldTick: number;
  recordedAt: string;
  actor: EventActor | null;
  location: Axial | null;
  /** The event or resolution that caused this event. */
  causationId: string | null;
  /** All events of one command share a correlation id (the resolution id). */
  correlationId: string | null;
  /** "public" events may reach the play view; "system" events are creator-only. */
  visibility: EventVisibility;
  payload: TPayload;
}

/* ------------------------------ payload shapes ------------------------------ */

export interface SiteState {
  id: string;
  siteType: string;
  name: string;
  tags: string[];
  asset?: string;
}

export interface FactState {
  id: string;
  category: string;
  tags: string[];
  data: Record<string, unknown>;
  status: "active" | "superseded";
  createdTick: number;
  createdBy: string;
  supersededBy?: string;
  /** Evolution band indexes already evaluated for this fact (idempotency). */
  evaluatedBands: number[];
  persistence: { mode: "permanent" | "evolves"; procedure?: string };
}

export interface HexMaterializedPayload {
  terrain: string;
  tags: string[];
  sites: SiteState[];
  facts: FactState[];
  contentRelease: string;
  /** Generation trace, including the home hex's initial materialization. */
  rolls: RollRecord[];
}

export interface PendingEncounter {
  encounterId: string;
  tableId: string;
  tableVersion: number;
  text: string;
  choices: ChoiceDef[];
  startedTick: number;
  hex: Axial;
  asset?: string;
  /** Authored display label for `asset`, carried so clients need not parse it. */
  assetLabel?: string;
}

export interface EncounterStartedPayload extends PendingEncounter {
  /** Entry id on the parent table that produced this encounter. */
  entryId: string;
}
