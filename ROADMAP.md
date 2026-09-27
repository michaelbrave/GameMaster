# Worldforge roadmap

> **Living document.** This supersedes [PLAN.md](./PLAN.md) (retired 2026-09-26, kept as a historical record) as the place where we decide what to build next. Update it when a decision is made or a phase ships; record significant decisions as [ADRs](./docs/adr).

## 1. Product direction

Worldforge is a suite of tools for dungeon masters that walks the line between a TTRPG and a videogame. The shipped foundation is a solo procedural hexcrawl: rules and authored tables resolve play, every outcome is seeded and replayable, and consequences persist and evolve with world time. The longer-term aim is for a DM to author and run their own worlds, procedures, tables, sites, factions, and lore — with multiplayer built on the same history-aware world model.

What makes this project distinct, and what every roadmap item should strengthen:

- **Procedures are authoritative.** Rules, tables, and explicit choices decide what happened. LLMs, if ever added, narrate resolved facts — they never decide them.
- **History is structured data.** Events are immutable; consequences link back to their causes; randomness is replayable from stored seeds and content versions.
- **The server protects hidden information.** The UI never decides what a player may see.
- **Content is data-first and versioned** so creators can extend the world without code.

## 2. Layout direction

**Square-diamond is the preferred board layout going forward** ([ADR 0007](./docs/adr/0007-square-diamond-preferred-layout.md)). The hex grid remains a first-class option at world creation. New topology-dependent features are designed against square-diamond first and implemented for both layouts through the shared grid abstraction — the server owns legal movement for both; the client only mirrors drawing geometry.

## 3. Current state (2026-09-26)

Shipped and tested: seeded lazy world generation (hex and square-diamond), deterministic nested roll-table oracle with authored choices, immutable event history with rebuildable projections, idempotency + optimistic concurrency, time-banded fact evolution (the bandits → remains → scavengers/bones/undead loop), Play/Build mode split, creator tools (table validate/preview/publish, complete history), a battlefield movement sandbox, and a Fight-encounter hook that opens it. 91 tests across unit, contract, integration (memory + real embedded PostgreSQL), Elm, and cross-process e2e.

Known limitations and the full known-bad list live in [HANDOFF.md](./HANDOFF.md) §7–8; the actionable ones are tracked in §6 below.

## 4. The roadmap

### Phase A — stabilize (current)

Fix the things that will bite before the feature set does (details in HANDOFF §7):

1. **Server scaling:** push history pagination into SQL (`history.ts` currently loads the whole event stream into JS); fix the `getMap` N+1 (one query per hex); prune superseded facts from `hex_projections` (the JSONB blob grows forever); batch the ~10 sequential round trips per command; cache battlefield `routesFor` per board version; stop `MemoryStore` deep-cloning the world per transaction.
2. **Client cleanup:** split `Views/Play.elm` (map / encounter / panels), deduplicate `errorBanner` (×3) and the encounter-choice UI (×2), move site/fact marker glyphs into content, fix `gen-fixtures.mjs` dead payloads, replace `String`-typed modes/kinds in `Battle.elm`/`Setup.elm` with custom types, Dict-keyed hex lookups instead of O(n²) scans.
3. **Hygiene:** enable `noUncheckedIndexedAccess`, fix the double URL-decode of table ids, rename the inverted `shouldListen` flag, dedupe the test `httpClient` helper, wire Playwright specs into CI or remove them, add UI paging for the journal.


### Phase B — make it a game (Tier 1)

The engine proves consequences; now the loop needs stakes. Cheapest first:

1. **Character sheet: HP + inventory.** The content already says "you take an ugly cut" and marks remains `lootable` — extend the effect vocabulary (`damage`, `heal`, `add_item`, `remove_item`) and add a character panel to the sidebar. This is the biggest single step from engine demo to game.
2. **"Search the remains" action** on hexes with lootable facts, resolved by a loot table. Deepens the consequence loop with one command + content.
3. **Rest/camp action** — deliberately advance world time (with a risk-table roll), making fact evolution something the player can intentionally provoke.
4. **A few authored goals** from the home hex ("clear the bandit camp", "map N spaces"), checked against world facts. A minimal win condition changes how the sandbox feels.
5. **Game feel (cheap, high impact):** animate travel along the path, fade in newly discovered spaces, render the last resolution as a dice tray in the journal, number-key shortcuts + focus trap in the encounter spotlight.

### Phase C — combat MVP (per ADR 0006)

Original-D&D/Whitebox-flavored, **party-based turns**, d20-style resolution, light and ruleset-pluggable:

1. **Model the party first** — a first-class persistent party (own stream + projection), not N tokens the client happens to render. Decide this on paper before writing combat code.
2. **Derive combat from the oracle** rather than running beside it: one deterministic trace, one history, combat becomes content.
3. Extend the battlefield's Run mode: party turns, attacks vs AC, damage, conditions, and **encounter completion written back through the oracle** as canonical events.
4. Pick the first encounter to model, on paper. Narrow beats broad.

### Phase D — the DM toolsuite

1. **Form-based content editors** in Build mode (table entries with weight/text/effect pickers, nested-table dropdowns; JSON stays as an advanced view), then terrain, site, encounter, and evolution-rule editors.
2. **World/session management UI:** list worlds, resume any session, rename/delete.
3. **Table lifecycle:** version diffs, deprecation, and a content-release migration path (a world pinned to `core@1.0.0` currently can never upgrade).
4. **Session recap export** — structured history → markdown "previously on…". Nearly free, and DMs will love it.
5. **DM time controls:** advance the tick manually, trigger an evolution sweep.
6. **World forking for creators:** copy events up to a point into a scratch world to playtest table changes. Event sourcing makes this cheap.

### Later — deliberately deferred

- **LLM narration**, strictly within the narrator boundary: narrate resolved facts, never decide outcomes. A "Narrate" flourish on journal entries is the right first shape. `TTRPG Software.md` is reference material, not a plan.
- **Multiplayer / shared worlds.** The idempotency and optimistic-concurrency groundwork supports it, but it only matters once the solo loop is fun.
- **Towns, dungeons, factions, NPCs** (BOARD_LAYOUTS "next modes") — scheduled after combat proves out.

## 5. Strategic questions to answer before heavy engine work

1. **What brings the player back?** Working answer: character persistence/progression plus a world that visibly changed while you were away (rest, evolution, goals). Revisit after Phase B.
2. **Party model shape** (gates all combat code).
3. **Combat-from-oracle vs. combat-beside-oracle** (working answer: from).
4. **Content throughput as a metric:** if a new biome + encounter chain can't be authored as pure data in about an hour, invest in Build-mode editors before more engine work.

## 6. Backlog

Everything here is also described in HANDOFF §7–8; this is the tracking list.

**Server:** SQL-side history pagination · `getMap` N+1 · `hex_projections.facts` pruning · batched command writes · `routesFor` caching · `MemoryStore` clone cost · `noUncheckedIndexedAccess` · table-id double decode · `shouldListen` rename · `config.ts` `__dirname` root derivation.

**Client:** split `Views/Play.elm` · shared `Views/Components.elm` (errorBanner, tabs) · dedupe encounter UI · glyphs from content · `gen-fixtures.mjs` dead payloads · custom types over mode/kind strings · Dict-keyed map lookups · battlefield board memoization.

**Testing/docs:** Playwright in CI · journal paging UI · table diff/deprecation · content-release migration path.

## 7. How we work

- **Thin vertical slices** over wide horizontal layers; contracts and fixtures before dependent implementation.
- **Definition of done:** acceptance behavior demonstrated; domain logic unit-tested, persistence/API integration-tested, critical journeys e2e-tested; payloads validate against checked-in contracts; errors/loading/empty/hidden-information states handled; formatting, lint, migrations, and tests pass from documented commands; docs updated with the code.
- **Significant decisions become ADRs** in `docs/adr`; this file tracks *what's next*, ADRs record *why*.
- Every handoff reports: scope covered, files/migrations changed, commands/tests run and results, contract assumptions, known limitations and follow-ups.
