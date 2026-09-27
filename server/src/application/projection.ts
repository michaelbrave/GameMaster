import type { Axial } from "../domain/axial";
import type {
  FactState,
  HexMaterializedPayload,
  PendingEncounter,
  SiteState,
} from "../domain/events";
import {
  hexStream,
  sessionStream,
  type HexProjectionRow,
  type SessionRow,
  type Tx,
} from "../infrastructure/store";

/**
 * Rebuild a hex projection purely from its append-only event stream.
 * Automated tests assert rebuild output matches the incremental projection.
 */
export async function rebuildHexProjection(
  tx: Tx,
  worldId: string,
  at: Axial,
): Promise<HexProjectionRow | null> {
  const events = await tx.listEventsByStream(hexStream(worldId, at));
  if (events.length === 0) return null;
  let hex: HexProjectionRow | null = null;
  for (const event of events) {
    switch (event.type) {
      case "hex_materialized": {
        const p = event.payload as unknown as HexMaterializedPayload;
        hex = {
          worldId,
          q: at.q,
          r: at.r,
          terrain: p.terrain,
          tags: [...p.tags],
          sites: p.sites.map((s) => ({ ...s }) as SiteState),
          facts: p.facts.map((f) => ({ ...f }) as FactState),
          materializedTick: event.worldTick,
          version: 0,
        };
        break;
      }
      case "site_added": {
        hex?.sites.push(event.payload.site as SiteState);
        break;
      }
      case "fact_created": {
        if (!hex) break;
        hex.facts.push({
          id: (event.payload.id as string | undefined) ?? event.id,
          category: event.payload.category as string,
          tags: (event.payload.tags as string[]) ?? [],
          data: (event.payload.data as Record<string, unknown>) ?? {},
          status: "active",
          createdTick: event.worldTick,
          createdBy: event.id,
          evaluatedBands: [],
          persistence: (event.payload
            .persistence as FactState["persistence"]) ?? { mode: "permanent" },
        });
        break;
      }
      case "fact_superseded": {
        if (!hex) break;
        const target = hex.facts.find(
          (f) => f.id === event.payload.factId && f.status === "active",
        );
        const successor = event.payload.successor as FactState;
        if (target) {
          target.status = "superseded";
          target.supersededBy = successor.id;
        }
        if (!hex.facts.some((f) => f.id === successor.id))
          hex.facts.push(successor);
        break;
      }
      case "evolution_evaluated": {
        const fact = hex?.facts.find((f) => f.id === event.payload.factId);
        const band = event.payload.band as number;
        if (fact && !fact.evaluatedBands.includes(band))
          fact.evaluatedBands.push(band);
        break;
      }
      default:
        break; // discoveries, logs, blocked travel: no projection impact
    }
    if (hex) hex.version += 1;
  }
  return hex;
}

/**
 * Rebuild session state (position, pending encounter, policy) from the
 * session event stream plus the resolution count.
 */
export async function rebuildSessionState(
  tx: Tx,
  sessionId: string,
): Promise<SessionRow | null> {
  const events = await tx.listEventsByStream(sessionStream(sessionId));
  const started = events.find((e) => e.type === "session_started");
  if (!started) return null;
  const base = started.payload as {
    characterName: string;
    creatorPolicy: SessionRow["creatorPolicy"];
    createdAt: string;
  };
  let q = 0;
  let r = 0;
  let pending: PendingEncounter | null = null;
  for (const event of events) {
    if (event.type === "character_moved") {
      const to = event.payload.to as Axial;
      q = to.q;
      r = to.r;
    } else if (event.type === "encounter_started") {
      const { entryId: _ignored, ...p } =
        event.payload as unknown as PendingEncounter & { entryId: string };
      pending = p;
    } else if (event.type === "encounter_resolved") {
      pending = null;
    }
  }
  const commands = await tx.countResolutions(sessionId);
  return {
    id: sessionId,
    worldId: started.worldId,
    characterName: base.characterName,
    q,
    r,
    status: "active",
    version: commands,
    creatorPolicy: base.creatorPolicy,
    pendingEncounter: pending,
    createdAt: base.createdAt,
  };
}
