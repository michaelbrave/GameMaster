import type { Axial } from "../../src/domain/axial";
import {
  DIRECTIONS,
  add,
  isWithinRadius,
  key as hexKey,
} from "../../src/domain/axial";

/**
 * Deterministic scripted playthrough shared by the seed scan and the HTTP
 * integration test. Strategy: explore neighbors in fixed direction order
 * until a bandit-style encounter appears, fight it, then leave for enough
 * ticks and return to observe the time-banded consequence.
 */
export interface PlayClient {
  post(path: string, body: unknown): Promise<{ status: number; body: any }>;
  get(path: string): Promise<{ status: number; body: any }>;
}

/** Minimal JSON HTTP client for integration tests, built on fetch. */
export function httpClient(baseUrl: string): PlayClient {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body),
  };
}

export interface PlaythroughResult {
  seed: string;
  worldId: string;
  sessionId: string;
  encounterHex: Axial;
  steps: number;
  remainsCategory: string;
  consequenceEvents: Array<{ type: string; category?: string }>;
  finalTick: number;
  log: string[];
}

interface SessionState {
  session: {
    id: string;
    version: number;
    position: Axial;
    pendingEncounter: { choices: Array<{ id: string; label: string }> } | null;
  };
  worldTick: number;
  reachable: Axial[];
}

async function state(
  client: PlayClient,
  sessionId: string,
): Promise<SessionState> {
  const res = await client.get(`/api/v1/sessions/${sessionId}`);
  if (res.status !== 200)
    throw new Error(`state failed: ${JSON.stringify(res.body)}`);
  return res.body as SessionState;
}

async function doTravel(
  client: PlayClient,
  sessionId: string,
  version: number,
  to: Axial,
  key: string,
) {
  const res = await client.post(
    `/api/v1/sessions/${sessionId}/commands/travel`,
    {
      idempotencyKey: key,
      expectedVersion: version,
      to,
    },
  );
  if (res.status !== 200)
    throw new Error(`travel failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function doAction(
  client: PlayClient,
  sessionId: string,
  version: number,
  choiceId: string,
  key: string,
) {
  const res = await client.post(
    `/api/v1/sessions/${sessionId}/commands/encounter-action`,
    {
      idempotencyKey: key,
      expectedVersion: version,
      choiceId,
    },
  );
  if (res.status !== 200)
    throw new Error(`action failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function hexDetail(client: PlayClient, sessionId: string, at: Axial) {
  const res = await client.get(
    `/api/v1/sessions/${sessionId}/hexes/${at.q}/${at.r}`,
  );
  if (res.status !== 200)
    throw new Error(`hex detail failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function playthrough(
  client: PlayClient,
  seed: string,
): Promise<PlaythroughResult> {
  const log: string[] = [];
  const worldRes = await client.post("/api/v1/worlds", {
    name: `scan-${seed}`,
    seed,
  });
  if (worldRes.status !== 201)
    throw new Error(`world create failed: ${JSON.stringify(worldRes.body)}`);
  const world = worldRes.body;
  const sessionRes = await client.post("/api/v1/sessions", {
    worldId: world.id,
    characterName: "Scan",
    creatorPolicy: { tablePreview: true, completeHistory: true },
  });
  if (sessionRes.status !== 201)
    throw new Error(
      `session create failed: ${JSON.stringify(sessionRes.body)}`,
    );
  const sessionId = sessionRes.body.session.id;

  let steps = 0;
  let encounterHex: Axial | null = null;
  let remainsCategory = "";
  const visited = new Set<string>(["0,0"]);
  const radius = sessionRes.body.regionRadius as number;

  // Phase 1: roam until a fight leaves evolving remains somewhere.
  for (let attempt = 0; attempt < 40 && !encounterHex; attempt += 1) {
    const s = await state(client, sessionId);
    const targets = DIRECTIONS.map((d) => add(s.session.position, d)).filter(
      (h) => isWithinRadius(h, radius),
    );
    const fresh = targets.filter((h) => !visited.has(hexKey(h)));
    const next = (fresh.length > 0 ? fresh : targets)[0];
    if (!next) break;
    const travel = await doTravel(
      client,
      sessionId,
      s.session.version,
      next,
      `scan-t-${seed}-${attempt}`,
    );
    visited.add(hexKey(next));
    steps += 1;
    log.push(...travel.resolution.text);
    if (travel.resolution.outcome === "encounter") {
      const choices = travel.session.pendingEncounter.choices as Array<{
        id: string;
      }>;
      if (choices.some((c) => c.id === "fight")) {
        const after = await state(client, sessionId);
        const fight = await doAction(
          client,
          sessionId,
          after.session.version,
          "fight",
          `scan-f-${seed}-${attempt}`,
        );
        steps += 1;
        log.push(...fight.resolution.text);
        const detail = await hexDetail(client, sessionId, next);
        const remains = detail.hex.facts.find(
          (f: any) => f.category === "remains",
        );
        if (remains) {
          encounterHex = next;
          remainsCategory = "remains";
        }
      } else {
        // Not a fightable encounter; resolve with the first choice to move on.
        const after = await state(client, sessionId);
        await doAction(
          client,
          sessionId,
          after.session.version,
          choices[0].id,
          `scan-x-${seed}-${attempt}`,
        );
        steps += 1;
      }
    }
  }
  if (!encounterHex)
    throw new Error(
      `seed ${seed}: no fightable remains-producing encounter in 40 steps`,
    );

  // Phase 2: wander away long enough for the ripe band (>= 3 ticks), then return.
  const home = encounterHex;
  let returned = false;
  for (let leg = 0; leg < 24 && !returned; leg += 1) {
    const s = await state(client, sessionId);
    const pos = s.session.position;
    const targets = DIRECTIONS.map((d) => add(pos, d)).filter((h) =>
      isWithinRadius(h, radius),
    );
    if (
      s.worldTick >= 4 &&
      hexKey(pos) !== hexKey(home) &&
      targets.some((h) => hexKey(h) === hexKey(home))
    ) {
      // Adjacent to the remains hex after enough elapsed ticks: step back in.
      const back = await doTravel(
        client,
        sessionId,
        s.session.version,
        home,
        `scan-back-${seed}`,
      );
      steps += 1;
      log.push(...back.resolution.text);
      returned = true;
      break;
    }
    // Prefer unvisited hexes that keep options open; deterministic order.
    const fresh = targets.filter(
      (h) => !visited.has(hexKey(h)) && hexKey(h) !== hexKey(home),
    );
    const candidates =
      fresh.length > 0
        ? fresh
        : targets.filter((h) => hexKey(h) !== hexKey(home));
    const next = candidates[0] ?? targets[0];
    if (!next) break;
    const t = await doTravel(
      client,
      sessionId,
      s.session.version,
      next,
      `scan-w-${seed}-${leg}`,
    );
    visited.add(hexKey(next));
    steps += 1;
    log.push(...t.resolution.text);
    if (t.resolution.outcome === "encounter") {
      const after = await state(client, sessionId);
      const choices = after.session.pendingEncounter!.choices as Array<{
        id: string;
      }>;
      const choice = choices.find((c) => c.id === "flee") ?? choices[0];
      await doAction(
        client,
        sessionId,
        after.session.version,
        choice.id,
        `scan-wx-${seed}-${leg}`,
      );
      steps += 1;
    }
  }
  if (!returned)
    throw new Error(`seed ${seed}: failed to return to the remains hex`);

  const detail = await hexDetail(client, sessionId, home);
  const finalState = await state(client, sessionId);
  const consequenceEvents: Array<{ type: string; category?: string }> = [];
  for (const entry of detail.history as Array<{ type: string; text: string }>) {
    if (entry.type === "fact_superseded" || entry.type === "fact_created") {
      consequenceEvents.push({ type: entry.type });
    }
  }
  const categories = (detail.hex.facts as Array<{ category: string }>).map(
    (f) => f.category,
  );
  return {
    seed,
    worldId: world.id,
    sessionId,
    encounterHex: home,
    steps,
    remainsCategory,
    consequenceEvents,
    finalTick: finalState.worldTick,
    log: [...log, `active facts now: ${categories.join(", ") || "none"}`],
  };
}

/** Find the first seed (deterministically) that produces the full loop. */
export async function findDemoSeed(
  client: PlayClient,
  candidates: string[],
): Promise<PlaythroughResult> {
  for (const seed of candidates) {
    try {
      const result = await playthrough(client, seed);
      if (result.consequenceEvents.some((e) => e.type === "fact_superseded")) {
        return result;
      }
    } catch {
      // keep scanning; candidate did not produce the full scenario
    }
  }
  throw new Error("no candidate seed produced the complete consequence loop");
}
