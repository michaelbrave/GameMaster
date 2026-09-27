import type { Axial } from "../domain/axial";
import type { PendingEncounter } from "../domain/events";
import type { CreatorPolicy, HexProjectionRow } from "../infrastructure/store";
import type { Engine } from "./engine";

export interface MarkerDto {
  key: string;
  label: string;
  icon: string;
}

export interface HexSummaryDto {
  q: number;
  r: number;
  terrain: string;
  terrainLabel: string;
  tags: string[];
  sites: {
    id: string;
    siteType: string;
    name: string;
    tags: string[];
    asset?: string;
  }[];
  facts: {
    id: string;
    category: string;
    tags: string[];
    createdTick: number;
  }[];
  markers: MarkerDto[];
  visitedTick: number;
}

export interface SessionDto {
  id: string;
  worldId: string;
  characterName: string;
  position: Axial;
  status: string;
  version: number;
  creatorPolicy: CreatorPolicy;
  pendingEncounter: PendingEncounter | null;
  createdAt: string;
}

const FACT_MARKERS: Record<string, { label: string; icon: string }> = {
  remains: { label: "Remains", icon: "icon:remains" },
  scavenged_remains: { label: "Scavenged remains", icon: "icon:bones" },
  stripped_remains: { label: "Stripped remains", icon: "icon:bones" },
  scattered_bones: { label: "Scattered bones", icon: "icon:bones" },
  dust: { label: "Dust of the dead", icon: "icon:bones" },
  scavenger_activity: { label: "Scavenger activity", icon: "icon:scavenger" },
  undead: { label: "Undead!", icon: "icon:undead" },
  haunting: { label: "Haunting", icon: "icon:haunting" },
  bandit_camp: { label: "Bandit camp", icon: "icon:bandits" },
  bandit_activity: { label: "Bandit activity", icon: "icon:bandits" },
};

/** Map markers are projections of canonical state, never independent state. */
export function markersFor(hex: HexProjectionRow): MarkerDto[] {
  const markers: MarkerDto[] = [];
  for (const site of hex.sites) {
    markers.push({
      key: `site:${site.id}`,
      label: site.name,
      icon: site.asset ?? "icon:site",
    });
  }
  for (const fact of hex.facts) {
    if (fact.status !== "active") continue;
    const m = FACT_MARKERS[fact.category] ?? {
      label: fact.category.replaceAll("_", " "),
      icon: "icon:fact",
    };
    markers.push({ key: `fact:${fact.id}`, label: m.label, icon: m.icon });
  }
  return markers;
}

export function toSummary(
  engine: Engine,
  hex: HexProjectionRow,
  visitedTick: number,
): HexSummaryDto {
  const terrain = engine.pack.terrain[hex.terrain];
  return {
    q: hex.q,
    r: hex.r,
    terrain: hex.terrain,
    terrainLabel: terrain?.label ?? hex.terrain,
    tags: hex.tags,
    sites: hex.sites,
    facts: hex.facts
      .filter((f) => f.status === "active")
      .map((f) => ({
        id: f.id,
        category: f.category,
        tags: f.tags,
        createdTick: f.createdTick,
      })),
    markers: markersFor(hex),
    visitedTick,
  };
}

export function toSessionDto(session: {
  id: string;
  worldId: string;
  characterName: string;
  q: number;
  r: number;
  status: string;
  version: number;
  creatorPolicy: CreatorPolicy;
  pendingEncounter: PendingEncounter | null;
  createdAt: string;
}): SessionDto {
  return {
    id: session.id,
    worldId: session.worldId,
    characterName: session.characterName,
    position: { q: session.q, r: session.r },
    status: session.status,
    version: session.version,
    creatorPolicy: session.creatorPolicy,
    pendingEncounter: session.pendingEncounter,
    createdAt: session.createdAt,
  };
}
