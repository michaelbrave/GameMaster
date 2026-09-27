import type { Axial } from "../domain/axial";
import { key as hexKey } from "../domain/axial";
import { gridSpaces, adjacent, type GridType } from "../domain/grid";
import type { SessionRow, Store, WorldRow } from "../infrastructure/store";
import { notFound } from "./errors";
import type { Engine } from "./engine";
import {
  toSessionDto,
  toSummary,
  type HexSummaryDto,
  type SessionDto,
} from "./dtos";
import { requirePinnedContent } from "./engine";

export interface SessionStateResponse {
  session: SessionDto;
  worldTick: number;
  worldName: string;
  regionRadius: number;
  gridType: GridType;
  reachable: Axial[];
  discoveredCount: number;
}

/** Legal one-step destinations from the session position on the world's grid. */
function reachableSpaces(
  engine: Engine,
  world: WorldRow,
  session: SessionRow,
): Axial[] {
  return gridSpaces(engine.pack.worldgen.regionRadius, world.gridType).filter(
    (h) => adjacent({ q: session.q, r: session.r }, h, world.gridType),
  );
}

export async function getSessionState(
  store: Store,
  engine: Engine,
  sessionId: string,
): Promise<SessionStateResponse> {
  return store.withTransaction(async (tx) => {
    const session = await tx.getSession(sessionId);
    if (!session) throw notFound(`session ${sessionId}`);
    const world = await tx.getWorld(session.worldId);
    if (!world) throw notFound(`world ${session.worldId}`);
    requirePinnedContent(world, engine);
    const discoveries = await tx.listDiscoveries(sessionId);
    const reachable = reachableSpaces(engine, world, session);
    return {
      session: toSessionDto(session),
      worldTick: world.currentTick,
      worldName: world.name,
      regionRadius: engine.pack.worldgen.regionRadius,
      gridType: world.gridType ?? "hex",
      reachable,
      discoveredCount: discoveries.length,
    };
  });
}

export interface MapResponse {
  worldTick: number;
  position: Axial;
  regionRadius: number;
  gridType: GridType;
  reachable: Axial[];
  hexes: HexSummaryDto[];
  legend: Record<
    string,
    {
      label: string;
      moveCost: number;
      passable: boolean;
      glyph: string;
      color: string;
    }
  >;
}

/** Play-view map: ONLY discovered hexes are returned; the server never leaks undiscovered state. */
export async function getMap(
  store: Store,
  engine: Engine,
  sessionId: string,
): Promise<MapResponse> {
  return store.withTransaction(async (tx) => {
    const session = await tx.getSession(sessionId);
    if (!session) throw notFound(`session ${sessionId}`);
    const world = await tx.getWorld(session.worldId);
    if (!world) throw notFound(`world ${session.worldId}`);
    requirePinnedContent(world, engine);
    const discoveries = await tx.listDiscoveries(sessionId);
    const visitedTick = new Map(discoveries.map((d) => [hexKey(d), d.tick]));
    // One query for the world's projections, then pick the discovered subset:
    // no per-hex round trips.
    const projections = await tx.listHexProjections(session.worldId);
    const byKey = new Map(projections.map((h) => [hexKey(h), h]));
    const hexes: HexSummaryDto[] = [];
    for (const d of discoveries) {
      const hex = byKey.get(hexKey(d));
      if (hex)
        hexes.push(toSummary(engine, hex, visitedTick.get(hexKey(d)) ?? 0));
    }
    hexes.sort((a, b) => a.r - b.r || a.q - b.q);
    const reachable = reachableSpaces(engine, world, session);
    const legend = Object.fromEntries(
      Object.values(engine.pack.terrain).map((t) => [
        t.key,
        {
          label: t.label,
          moveCost: t.moveCost,
          passable: t.passable,
          glyph: t.glyph,
          color: t.color,
        },
      ]),
    );
    return {
      worldTick: world.currentTick,
      position: { q: session.q, r: session.r },
      regionRadius: engine.pack.worldgen.regionRadius,
      gridType: world.gridType ?? "hex",
      reachable,
      hexes,
      legend,
    };
  });
}
