import assert from "node:assert/strict";
import type { Axial } from "../../src/domain/axial";
import type { PlayClient } from "./playthrough";

interface HistoryEntry {
  seq: number;
  tick: number;
  type: string;
  location: Axial | null;
  text: string;
}

interface HistoryPage {
  entries: HistoryEntry[];
  total: number;
  offset: number;
  limit: number;
}

async function mustGet(client: PlayClient, path: string) {
  const res = await client.get(path);
  assert.equal(res.status, 200, `GET ${path}: ${JSON.stringify(res.body)}`);
  return res.body;
}

/**
 * Shared history-pagination journey, run against both store adapters
 * (memory in historyPagination.test.ts, real PostgreSQL in pg.test.ts).
 * Verifies that visibility filtering and offset/limit pagination happen in
 * the store with identical semantics: pages are slices of the full log,
 * totals match, ordering is by global seq, per-hex history only contains
 * events at that hex, and system events (battlefield edits) never enter
 * the play log.
 */
export async function historyJourney(client: PlayClient): Promise<void> {
  const worldRes = await client.post("/api/v1/worlds", {
    name: "history-journey",
    seed: "hist-1",
  });
  assert.equal(worldRes.status, 201, JSON.stringify(worldRes.body));
  const worldId = worldRes.body.id;
  const sessionRes = await client.post("/api/v1/sessions", {
    worldId,
    characterName: "Archivist",
  });
  assert.equal(sessionRes.status, 201, JSON.stringify(sessionRes.body));
  const sessionId = sessionRes.body.session.id;

  // Take a few actions so the log has substance; resolve any encounter with
  // its first choice so travel can continue.
  let actions = 0;
  for (let i = 0; i < 12 && actions < 4; i++) {
    const state = await mustGet(client, `/api/v1/sessions/${sessionId}`);
    if (state.session.pendingEncounter) {
      const choice = state.session.pendingEncounter.choices[0];
      const res = await client.post(
        `/api/v1/sessions/${sessionId}/commands/encounter-action`,
        {
          idempotencyKey: `hist-action-${actions}`,
          expectedVersion: state.session.version,
          choiceId: choice.id,
        },
      );
      assert.equal(res.status, 200, JSON.stringify(res.body));
      actions += 1;
      continue;
    }
    const to = state.reachable[0];
    const res = await client.post(
      `/api/v1/sessions/${sessionId}/commands/travel`,
      {
        idempotencyKey: `hist-travel-${actions}`,
        expectedVersion: state.session.version,
        to,
      },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    actions += 1;
  }
  assert.ok(actions >= 4, "journey produced enough actions");

  // The full log (under the 500 cap) is the reference for every page.
  const full = (await mustGet(
    client,
    `/api/v1/sessions/${sessionId}/history?limit=500`,
  )) as HistoryPage;
  assert.ok(full.total >= 5, "journey produced enough history");
  assert.equal(full.entries.length, full.total);
  for (let i = 1; i < full.entries.length; i++) {
    assert.ok(
      full.entries[i].seq > full.entries[i - 1].seq,
      "entries ordered by global seq",
    );
  }

  // A page is exactly the matching slice of the full log.
  const page = (await mustGet(
    client,
    `/api/v1/sessions/${sessionId}/history?offset=1&limit=2`,
  )) as HistoryPage;
  assert.deepEqual(page.entries, full.entries.slice(1, 3));
  assert.equal(page.total, full.total);
  assert.equal(page.offset, 1);
  assert.equal(page.limit, 2);

  // Past the end: empty page, truthful total.
  const pastEnd = (await mustGet(
    client,
    `/api/v1/sessions/${sessionId}/history?offset=${full.total + 10}&limit=5`,
  )) as HistoryPage;
  assert.deepEqual(pastEnd.entries, []);
  assert.equal(pastEnd.total, full.total);

  // limit=0 is coerced to the minimum page of one entry.
  const floor = (await mustGet(
    client,
    `/api/v1/sessions/${sessionId}/history?offset=0&limit=0`,
  )) as HistoryPage;
  assert.equal(floor.limit, 1);
  assert.deepEqual(floor.entries, full.entries.slice(0, 1));

  // Battlefield edits are system events and never enter the play log.
  const state = await mustGet(client, `/api/v1/sessions/${sessionId}`);
  const pos = state.session.position;
  const boardUrl = `/api/v1/sessions/${sessionId}/battlefields/${pos.q}/${pos.r}`;
  const board = await mustGet(client, boardUrl);
  const edit = await client.post(boardUrl, {
    expectedVersion: board.version,
    commandId: "hist-obstacle",
    action: { type: "obstacle", at: { q: 1, r: 1 } },
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const afterEdit = (await mustGet(
    client,
    `/api/v1/sessions/${sessionId}/history?limit=500`,
  )) as HistoryPage;
  assert.equal(
    afterEdit.total,
    full.total,
    "system events stay out of the log",
  );
  assert.deepEqual(afterEdit.entries, full.entries);

  // Hex detail history contains only public events located at that hex.
  const detail = await mustGet(
    client,
    `/api/v1/sessions/${sessionId}/hexes/${pos.q}/${pos.r}`,
  );
  assert.ok(detail.history.length > 0, "current hex has history");
  for (const entry of detail.history as HistoryEntry[]) {
    assert.ok(entry.location, "hex history entries are located");
    assert.deepEqual(
      { q: entry.location?.q, r: entry.location?.r },
      { q: pos.q, r: pos.r },
    );
  }
}
