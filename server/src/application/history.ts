import type { Axial } from "../domain/axial";
import type { WorldEvent } from "../domain/events";
import type { Store } from "../infrastructure/store";
import { ApiError, notFound } from "./errors";
import type { Engine } from "./engine";
import { requirePinnedContent } from "./engine";
import { toSummary, type HexSummaryDto } from "./dtos";

export interface LogEntryDto {
  seq: number;
  tick: number;
  type: WorldEvent["type"];
  location: Axial | null;
  text: string;
}

/** Player-readable rendering of a public event for the text log. */
export function describeEvent(event: WorldEvent): string {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case "session_started":
      return `${p.characterName} enters the world.`;
    case "hex_discovered":
      return `Discovered ${p.terrain} at ${event.location?.q},${event.location?.r}.`;
    case "character_moved": {
      const to = p.to as Axial;
      return `Traveled to ${to.q},${to.r} (${p.terrain}, cost ${p.cost}).`;
    }
    case "travel_blocked":
      return `${p.reason}.`;
    case "time_advanced":
      return `Time passes: tick ${p.fromTick} → ${p.toTick}.`;
    case "encounter_started":
      return `${p.text}`;
    case "encounter_resolved":
      return `Choice: ${p.choiceLabel}. ${(p.text as string[]).join(" ")}`;
    case "fact_created":
      return `A new fact takes hold: ${String(p.category).replaceAll("_", " ")}.`;
    case "fact_superseded": {
      const succ = p.successor as { category?: string } | undefined;
      return `The ${String(p.category).replaceAll("_", " ")} has become ${String(succ?.category ?? "something else").replaceAll("_", " ")}.`;
    }
    case "site_added": {
      const site = p.site as { name?: string } | undefined;
      return `A site appears: ${site?.name ?? "unknown"}.`;
    }
    case "log_appended":
      return String(p.text);
    case "world_created":
      return `World "${p.name}" created (${p.contentRelease}).`;
    default:
      return event.type;
  }
}

export interface HexDetailResponse {
  hex: HexSummaryDto;
  history: LogEntryDto[];
}

/** Hex detail for the play view; undiscovered hexes are indistinguishable from nonexistent ones. */
export async function getHexDetail(
  store: Store,
  engine: Engine,
  sessionId: string,
  at: Axial,
): Promise<HexDetailResponse> {
  return store.withTransaction(async (tx) => {
    const session = await tx.getSession(sessionId);
    if (!session) throw notFound(`session ${sessionId}`);
    const discoveries = await tx.listDiscoveries(sessionId);
    const discovery = discoveries.find((d) => d.q === at.q && d.r === at.r);
    if (!discovery) {
      throw notFound(`hex ${at.q},${at.r}`);
    }
    const hex = await tx.getHexProjection(session.worldId, at);
    if (!hex) throw notFound(`hex ${at.q},${at.r}`);
    const world = await tx.getWorld(session.worldId);
    if (!world) throw notFound(`world ${session.worldId}`);
    requirePinnedContent(world, engine);
    const events = await tx.listEventsByWorld(session.worldId);
    const history = events
      .filter(
        (e) =>
          e.visibility === "public" &&
          e.location &&
          e.location.q === at.q &&
          e.location.r === at.r,
      )
      .map((e) => ({
        seq: e.seq,
        tick: e.worldTick,
        type: e.type,
        location: e.location,
        text: describeEvent(e),
      }));
    return { hex: toSummary(engine, hex, discovery.tick), history };
  });
}

export interface HistoryResponse {
  entries: LogEntryDto[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Chronological play log: public events on the session stream plus public
 * events at hexes the character has discovered. Nothing undiscovered leaks.
 */
export async function getHistory(
  store: Store,
  sessionId: string,
  offset = 0,
  limit = 100,
): Promise<HistoryResponse> {
  return store.withTransaction(async (tx) => {
    const session = await tx.getSession(sessionId);
    if (!session) throw notFound(`session ${sessionId}`);
    const discoveries = await tx.listDiscoveries(sessionId);
    const known = new Set(discoveries.map((d) => `${d.q},${d.r}`));
    const events = await tx.listEventsByWorld(session.worldId);
    const visible = events.filter((e) => {
      if (e.visibility !== "public") return false;
      if (!e.location) return true;
      return known.has(`${e.location.q},${e.location.r}`);
    });
    const entries = visible
      .map((e) => ({
        seq: e.seq,
        tick: e.worldTick,
        type: e.type,
        location: e.location,
        text: describeEvent(e),
      }))
      .sort((a, b) => a.seq - b.seq);
    const capped = Math.min(Math.max(limit, 1), 500);
    return {
      entries: entries.slice(offset, offset + capped),
      total: entries.length,
      offset,
      limit: capped,
    };
  });
}

export interface CreatorHistoryResponse {
  events: WorldEvent[];
  resolutions: unknown[];
}

/** Complete unredacted history; gated by the session's creator visibility policy. */
export async function getCreatorHistory(
  store: Store,
  sessionId: string,
): Promise<CreatorHistoryResponse> {
  return store.withTransaction(async (tx) => {
    const session = await tx.getSession(sessionId);
    if (!session) throw notFound(`session ${sessionId}`);
    if (!session.creatorPolicy.completeHistory) {
      throw new ApiError(
        "forbidden",
        "complete-history inspection is disabled by this session's visibility policy",
      );
    }
    const events = await tx.listEventsByWorld(session.worldId);
    const resolutions = await tx.listResolutionsBySession(sessionId);
    return { events, resolutions };
  });
}
