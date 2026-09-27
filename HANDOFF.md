# Worldforge — implementation handoff

**Date:** 2026-09-26 · **Scope:** first playable vertical slice + hardening pass · **State:** implemented, fully tested, committed, and pushed. The working agreement and backlog have moved to [ROADMAP.md](./ROADMAP.md) (PLAN.md is retired); see §12 for the post-review doc reorganization.

> **Read §7 before starting work.** It lists the known-bad items, deliberately in priority order. Several items previously listed here as limitations are now fixed; if you find a claim below that contradicts the code, trust the code and fix this file.

## 1. What this is

A local, solo, procedural hex-crawl engine with replayable, persistent consequences:

1. A player starts a **seeded finite world** (radius 2 → 19 hexes on a hex grid, or a 41-space square-diamond board; `content/core`).
2. Entering an ungenerated neighboring hex **deterministically materializes** its terrain/sites/facts from `(world seed, pinned content release, q, r)` and persists them.
3. Travel advances **explicit world time** (integer ticks, terrain move cost) and records discovery.
4. A deterministic weighted/bounded-dice **nested roll-table oracle** produces encounters; nested rolls share one recorded resolution trace.
5. The player picks from **authored choices** (fight / flee / bargain). A choice may **declare a presentation surface** in content (currently `battlefield`) — the client never infers behavior from a choice id.
6. The engine appends **immutable events**, stores the **replayable resolution trace**, and updates **rebuildable projections** — atomically, with idempotency keys + optimistic version checks.
7. Later visits observe **time-banded fact evolution**: bandit/beast remains can attract scavengers, get picked clean, decay to bones/dust, or rise as undead — always as new linked events; the original event is never rewritten.
8. The UI presents a **text log**, an SVG map with keyboard + text-list equivalents, and **state-derived markers**.
9. A **creator view** can list/inspect/edit tables, validate drafts, preview seeded rolls, publish new immutable versions, and inspect the complete unredacted history — gated by a session-level visibility policy.
10. A **battlefield sandbox** resolves routes and validates actions for a combat encounter declared by an oracle choice.

The slice is a **sandbox loop**: no quests, progression, victory state, TTRPG combat rules, or autonomous simulation. LLMs are nowhere in the loop; mechanics and authored content are authoritative.

## 2. Run it

```bash
npm run setup                 # server + client dependencies (client pins elm 0.19.1)
npm run dev                   # docker-compose PostgreSQL + build + serve :4020
npm run dev:memory            # same without Docker (in-memory store, no restart persistence)
```

Open <http://localhost:4020> → create a world (any seed) → travel with arrow keys + Enter. `http://localhost:4020/?fixtures=1` is an offline, read-only demo session bundled from real engine output.

Verify:

```bash
npm test                      # 91 distinct tests (see §3 for the double-count caveat)
npm run demo                  # narrated transcript of the full consequence loop
npm run lint                  # tsc --noEmit + elm make
npm run format:check          # prettier (server) + elm-format (client)
```

`npm test` takes ~60–90 s, dominated by the embedded PostgreSQL suite and the deterministic seed scan.

## 3. Tests

**93 distinct tests, all passing.** `npm test` prints `73 / 6 / 19 / 1` because `test:contracts` re-runs the 6 contract tests that `test:server` already includes.

| Suite | Count | Covers |
| --- | --- | --- |
| `server/test/unit` | 42 | axial math, grid/spacing (hex + square-diamond), rng/dice determinism, weighted/dice/nested table resolution, conditions, cycle/depth guards, draft validation, biome clustering, battlefield routing |
| `server/test/contracts` | 6 | checked-in fixtures + **live** responses vs JSON Schemas; all 12 content tables + evolution rule vs the content contract; OpenAPI `$ref` sanity |
| `server/test/integration` (in-memory) | 20 | full consequence loop over HTTP, replay determinism, idempotent retry, 409/422 mapping, hidden-info filtering (404 + no leakage), projection rebuild == incremental, creator tools + policy gating, square-diamond grid, battlefield journey, content-declared presentation surface, store-side history pagination |
| `server/test/integration/pg.test.ts` | 5 | **real PostgreSQL** (embedded binaries, user-space): idempotent migrations, full loop, projection rebuild, SQL-level idempotency/concurrency, `grid_type` persistence, SQL history filtering/pagination |
| `client/tests` (elm-test) | 19 | contract decoders against real engine fixtures (incl. presentation surface + rejection of a misspelled one), API error-envelope decoding, hex/board geometry |
| `e2e/consequence-loop.test.mjs` | 1 | spawned server process, full loop over real HTTP, full event vocabulary + stored roll traces |

Playwright specs exist at `e2e/playwright/*.spec.ts` but are **not** wired into `npm test` (browsers not installed everywhere; see `e2e/README.md`).

The PLAN §11 success measures hold: 100% deterministic replay for identical seeds/command sequences; no duplicate events on retries; rebuilds match incremental projections on both store adapters; no undiscovered facts in play payloads; a creator can validate/publish a table without code changes; the bandits→remains→consequence scenario is covered by integration + pg + e2e tests.

## 4. Where things live

```text
client/src/            Elm 0.19.1 app: Main (update loop), State (Model/Msg), Types (contract
                       decoders), Api (HTTP + error-envelope boundary), Setup, Build (creator
                       view), Battle (battlefield sandbox), Views/Play (map/list/log/trace),
                       HexGrid, BoardGrid, Util, Fixtures (generated, offline mode)
server/src/domain/     PURE rules: axial, grid, rng (sha256→mulberry32), dice, tables, hexgen,
                       evolution, validate, battlefield, content, events, ids — no I/O anywhere
server/src/application/ content loader, commands (prelude: idempotency+version checks), travel,
                       encounterAction, effects interpreter, evolution runner, queries/history
                       (server-side visibility filtering), tablesService, battlefields,
                       projection rebuilds, dtos
server/src/infrastructure/ Store port + memory/Pg adapters, SQL migrations + runner
server/src/http/       node:http router (request ids, JSON, error envelope, static client), routes
contracts/             openapi.json ($refs the shared schemas — edit those, not this),
                       json-schema/*.json (10 files), fixtures/ (REGENERATED by
                       `npm run fixtures` from a real engine run — don't hand-edit)
content/core/          versioned seed pack: manifest, terrain, worldgen, 12 tables,
                       remains-evolution rule (fresh 0-3 / ripe 3-8 / old 8+)
e2e/                   cross-process test + demo.mjs + playwright/ scaffold (not wired in)
docs/adr/              6 ADRs: stack, axial+finite world, events/projections/replay,
                       time+evolution, content format + visibility policy, play/build modes
docs/                  DEVELOPMENT.md (command flow), BATTLEFIELD_SANDBOX.md, BOARD_LAYOUTS.md
```

## 5. Key invariants (do not break)

- **Domain modules stay pure.** All I/O in application/infrastructure. Resolution = f(content versions, context, seed).
- **Events are append-only.** Fact change = new linked event (`fact_superseded` with `causationId`), never a rewrite.
- **Every random value is stored** in the resolution trace (weighted roll + totalWeight; dice expr + individual dice; table id+version; nesting depth).
- **Seeds derive only from** `(worldSeed, contentRelease, purpose, deterministic context)` — never random session ids (this is what makes cross-world replay byte-identical).
- **A `hex_materialized` event is a complete snapshot** of terrain/tags/sites/facts. Materialization emits that one event and no follow-up `site_added`/`fact_created`; the rebuild depends on it.
- **Idempotency**: `(sessionId, idempotencyKey)` unique; same key + same payload → stored response; same key + different payload → 422 `command_rejected`; stale `expectedVersion` → 409 `version_conflict`; a **lost insert race** → 409 `version_conflict` (not 500).
- **Evolution idempotency**: per `(fact, bandIndex)` via `fact.evaluatedBands`; catch-up evaluates due bands in order and stops when superseded.
- **Play endpoints return discovered state only.** Undiscovered hex = 404, indistinguishable from nonexistent. The server filters; the client never decides.
- **Content is a closed vocabulary**: effects are `log | add_fact | supersede_fact | add_site`; choice `presentation` is a closed enum; no executable content; dice bounded (`d6`, `2d6`, `2d6+1`).
- **`noUnusedLocals`/`noUnusedParameters` are on.** Dead code fails `npm run lint`.
- Migrations are **append-only** after sharing; fix forward with a new file.
- After changing API responses: `npm run fixtures` **and** `cd client && node gen-fixtures.mjs`, then re-run `npm test`.

## 6. What the 2026-09-26 hardening pass changed

Correctness-first; the intent was to remove silent failure modes, not to add features.

1. **Content declares combat, not the client.** `Main.elm` previously hardcoded `choiceId == "fight"`, so renaming a choice in JSON silently broke the battlefield. `ChoiceDef.presentation` (closed enum, validated at content load) and `TableResultPayload.assetLabel` (authored display names) replaced both the magic string and the asset-string→label munging.
2. **The client surfaces real error reasons.** `Http.expectJson` discards the body on failure, so a stale-version refusal rendered as "server returned status 409". `Api.elm` now decodes the contract envelope and renders `version_conflict (409): session version is 3, command expected 2`, and exposes an explicit `exposing` list instead of `(..)`. The now-orphaned `Types.ApiError` type and its decoder were removed.
3. **Idempotency race → 409** instead of 500 (`rethrowIdempotencyRace` in `commands.ts`).
4. **Home hex materialization was lying** — it claimed `sites: []`/`facts: []`, carried an undeclared `home: true` key, and used a different fact-id scheme than the lazy path. Both paths now share `materializeHex`, which gained a `forceTerrain` mode (recorded as *no* terrain roll, because none happens).
5. **Stale fixtures fixed.** Fixtures predated the `square-diamond` feature and had no `gridType`; a `Decode.oneOf […, succeed "hex"]` shim existed in the client solely to tolerate them. Both are gone — the client is strict again.
6. **Dead code removed** (`tableLookup`, `findBand`, `describeBand`, `DIRECTION_NAMES`, `requireWorld`, an injected-but-discarded `PgStore.logger`, two unused params, 13 unused imports) **and the compiler now prevents recurrence.**
7. **Wildcard CORS removed** — the client is served by this same process and calls `window.location.origin`, so requests are same-origin. Wildcard CORS on a state-changing local API was needless exposure.

## 7. Known-bad, in priority order

> These items are now tracked in [ROADMAP.md](./ROADMAP.md) §6 (backlog) and §4 Phase A. This section remains the detailed description.

### Tier 2 — scaling (will bite before the feature set does)

1. ~~**`getHistory` / `getHexDetail` / `getCreatorHistory` load the entire world event stream** and filter/paginate in JavaScript (`application/history.ts`). `offset`/`limit` never reach SQL, and `total` forces a full scan regardless. Every history read is O(total events ever). Fix: push pagination into SQL.~~ **FIXED 2026-09-26:** the store port gained `EventQuery` (visibility / location-set / unlocated-inclusion filters + offset/limit) and `countEventsByWorld`, implemented identically by both adapters (`PgTx.eventsFilter` ⇆ `MemoryStore.filterWorldEvents` — keep them in lockstep). `getHistory` and `getHexDetail` filter and paginate in storage; migration `0003` adds the supporting indexes; `routes.ts` no longer turns `limit=0` into the default. Verified by `test/integration/historyJourney.ts` run against memory **and** real PostgreSQL. `getCreatorHistory` intentionally still returns everything — it is the complete-history creator tool.
2. ~~**`getMap` is an N+1** — one `getHexProjection` query per discovered hex (`queries.ts`); `listHexProjections` exists and is unused by the query path.~~ **FIXED 2026-09-26:** one `listHexProjections` call keyed into a `Map`; the duplicated `reachable` computation was extracted into `reachableSpaces`.
3. **`hex_projections.facts` grows without bound.** Superseded facts are never pruned, so the JSONB blob and every map/detail rebuild grow monotonically with world age. The most likely thing to actually hurt on a long run.
4. **A single travel command is ~10 sequential DB round trips.** `EventFactory.emit` does a `SELECT MAX(stream_version)` the first time a command touches each stream; `appendEvents` inserts one row per event, unbatched.
5. **`routesFor` is O(spaces²) BFS called per token per response** (`domain/battlefield.ts`). Fine at radius 2–8 today, unusable at radius 8 with 50 tokens.
6. **`MemoryStore` deep-clones the entire world on every transaction**, so `npm run dev:memory` degrades as a world grows and it's a poor structural analogue for the pg adapter.

### Tier 3 — cleanup (cheap, prevents rot)

7. **Duplicated code** — mostly **FIXED 2026-09-26**: `errorBanner` now lives in `client/src/Views/Components.elm` (parameterized on the dismiss message; used by Play, Build, Setup); the test `httpClient` is exported once from `test/integration/playthrough.ts`; the `reachable` computation is `reachableSpaces` in `queries.ts`; the encounter-choice UI is one `choiceButtons` in `Views/Play/Encounter.elm` shared by the spotlight and the sidebar panel. **Remaining:** `formatRef` still duplicates `domain/content.ts formatTableRef`.
8. **`Fixtures.elm` carries ~9 KB of dead payloads** (`actionJson`, `hexDetailJson`) plus an `unused : Encode.Value` that exists only to justify a generated import. Fix in `client/gen-fixtures.mjs`.
9. **N+1-ish client rendering**: `Views/Play.elm isDiscovered` is a `List.any` per reachable hex; `boardBackdrop` generates `(4r+1)²` polygons; `Battle.elm spaces` recomputes the board every render. All fine at current radii, all O(n²).
10. **Type safety holes**: `noUncheckedIndexedAccess` is still `false`; `hexStream()` is called with whole `HexProjectionRow` objects where an `Axial` is expected (the `EventFactory` defensively re-normalizes); `travel.ts` mutates the `world` row in place; `config.ts` derives the repo root from `__dirname`, which only works under the `dist/src/` layout.
11. **Double URL-decoding of table ids** — `HttpApp.match` decodes, then `routes.ts` decodes again because ids contain `/`. Harmless today, wrong for a `%252F`.
12. **`app.ts` misnames its flag** — `shouldListen` takes the port-0 branch when *false*.
13. **Marker glyphs are a hardcoded client map** (`Views/Play.elm`, `"icon:bandits" -> "⚔"`). Cosmetic only — it has a safe fallback and cannot cause a silent behavioral break — but it is the same class of coupling fixed in §6.1. Terrain glyphs already live in content; site glyphs do not.

### Tier 4 — the strategic fork (decide before more engine work)

15. **The battlefield is built ahead of its rules.** `Battle.elm` is 777 lines of routing sandbox; its own docs say there are "no attacks, initiative, automated enemies, combat outcomes, line of sight, difficult terrain, or token-size rules." ADR 0006 committed on 2026-09-26 to "original-D&D/Whitebox-flavored, party-based turns rather than per-unit initiative, d20 resolution, light rules, ruleset-pluggable" — but nothing in the code models a party yet. Open questions, in order:
    - **What is the atomic unit of play?** Party-based turns implies a *party* is a first-class persistent object (a party stream, party state as a projection), not N tokens the client happens to render. Cheaper to add now than after combat exists.
    - **Should combat be derived from the oracle rather than run beside it?** Today entering a fight means the client switches screens while the nested table resolves independently. Deriving the scenario from the oracle (who, what terrain, what's at stake) would keep one deterministic trace, one history, one set of rules components — and make combat *content*, per the `CONTEXT.md` definition of a rules component.
    - **Which encounter do we model first, on paper?** Narrow beats broad. See also `PLAN.md` §10.
16. **The scarce resource is authored content, not code.** 12 tables and 1 evolution rule ship today. Every feature multiplies the authoring burden. A "content throughput" test — can a new biome + encounter chain be authored in an hour, purely as data? — would say more about whether this is fun than any engine work.
17. **What brings the player back?** World time advances only on travel and only drives fact evolution. That is coherent and replayable, but it makes a session a finite walk. Whether the loop is a longer walk, a deeper world, or returning to a world that changed while you were away is a product decision that should precede more engine work.

## 8. Smaller open items

- **Playwright** — specs at `e2e/playwright/*.spec.ts` are not in `npm test`; install browsers to enable. The HTTP e2e covers the same loop meanwhile.
- **Table lifecycle** — only "publish new immutable version" exists; no deprecation, diffing, or pack re-export.
- **Log UX** — the history endpoint paginates; the UI loads the latest 200 entries with no paging controls.
- **Content-release upgrades** — a world pins `core@1.0.0` and refuses to run against a different release. There is no migration path between releases.
- **`.scratch/worldforge-first-playable-spec/issues/*.md`** — all six tickets are still marked `Status: open` for a slice that is complete. Close or annotate them.
- **`PLAN.md` §7** — Phase 5/6 task checkboxes are unchecked, including work that is demonstrably done.
- **`README.md`** — the repository tree predates the battlefield and square-grid subsystems and omits `docs/BATTLEFIELD_SANDBOX.md`, `docs/BOARD_LAYOUTS.md`, `docs/adr/0006`, and `contracts/json-schema/battlefield.json`.

## 9. Working state

- Branch `main`, pushed to `origin`. History: the initial Elm-scaffold commit, then the full vertical slice (battlefield, square-diamond grid, Play/Build modes, hardening pass) as one feature commit, then the documentation reorganization as a docs commit. The intermediate states were never separable — the slice was developed in one long uncommitted session — so the feature commit is intentionally large.
- `client/src/Views/Creator.elm` (replaced by `Build.elm`) was dropped from the index, not committed.
- Only generated artifacts intentionally untracked: `dist/`, `node_modules/`, `elm-stuff/`, `client/public/main.js` (all gitignored; rebuild with `npm run build`).
- `.scratch/`, `TTRPG Software.md`, `new-ideas`, `CONTEXT.md`, `IMPLEMENTATION_AGENT_PROMPT.md` are pre-existing planning inputs — committed, annotated as historical/superseded where stale.

## 10. Assumptions / deviations from PLAN.md (accepted, recorded in PLAN's update note + ADRs)

- **Seeded lazy hex generation replaced the hand-authored first region** (SH-004), per the Wayfinder handoff.
- **No HTTP framework** — a ~150-line `node:http` router keeps runtime deps to `pg`/`ajv`/`ajv-formats` (ADR 0001).
- **Store is a port with two adapters**: PostgreSQL (production) + in-memory (tests, `WORLDFORGE_STORE=memory`). Pg integration tests use `embedded-postgres` (real binaries, user-space, test-only devDependency). Docker Compose remains the dev database.
- **Evolution is lazy** (on time advance / hex load), not a background worker.
- **Fixture-backed Elm boundary** = offline read-only playback of recorded engine output, not a second engine in Elm.
- **Hex *and* square-diamond grids** both ship; the grid type is a world property persisted by migration `0002`.
- Elm toolchain pinned via npm (`elm@0.19.1-6`) because the PATH binary was a 0.19.2 fork.

## 11. Task-ID coverage (PLAN.md §7)

- **Phase 0:** SH-001–SH-004, FE-001/FE-002, BE-001–BE-003 — done (layout, ADRs, contracts+fixtures, content pack, client shell + API boundary, server bootstrap + migrations + loader).
- **Phase 1:** SH-101/102, FE-101–104, BE-101–BE-104 — done for the seeded-generation model (map/list/inspector/history, discovery persistence, projection queries, server-side visibility).
- **Phase 2:** SH-201/202, FE-201–204 (travel UI is button/keyboard driven), BE-201–205 — done (deterministic evaluator, conditions/cycles/depth/immutability, travel+time+discovery+idempotency+optimistic concurrency, player-safe traces, boundary/determinism tests).
- **Phase 3 (consequence loop):** done — bandits/beasts → remains → scavengers / picked-clean / bones / dust / undead, covered by integration + pg + e2e tests.
- **Phase 4 (creator tools):** validation/preview/publish + complete-history view done; lifecycle beyond immutable versions deferred.
- **Undocumented in PLAN:** the battlefield sandbox and square-diamond grid shipped without PLAN task IDs. Resolved 2026-09-26 by retiring PLAN.md — ROADMAP.md tracks work by phases instead of task IDs.
- **Phase 5+:** untouched by design.

## 12. Post-review updates (2026-09-26)

A full codebase review was done on this date. Outcomes:

**Documentation reorganization**

- **PLAN.md is retired** (banner at top, kept as history). **[ROADMAP.md](./ROADMAP.md)** is the living planning document: product direction, phases, backlog, and the working agreement (condensed from PLAN §8–9).
- **README.md** repo tree, architecture, and roadmap sections updated to cover the battlefield, square-diamond grid, Play/Build modes, and the doc reorganization.
- **[ADR 0007](./docs/adr/0007-square-diamond-preferred-layout.md): square-diamond is the preferred layout going forward; hex remains first-class.** New topology-dependent features are designed against square-diamond first and implemented for both layouts through the shared grid abstraction.
- `IMPLEMENTATION_AGENT_PROMPT.md` and the six `.scratch` slice tickets annotated as historical/superseded.
- PLAN §7 checkbox drift is moot now that PLAN is retired (was listed in §8).

**Improvement tiers recorded** — full detail in ROADMAP.md §4; summary:

- **Fixes first (Phase A):** the §7 Tier-2 scaling items (SQL-side history pagination, `getMap` N+1, facts pruning, batched command writes, `routesFor` caching, MemoryStore clone cost) plus the §7 Tier-3 cleanups and three new ones from the review: split `Views/Play.elm` into map/encounter/panels modules, replace `String`-typed modes/kinds in `Battle.elm`/`Setup.elm` with custom types, and Dict-keyed hex lookups instead of O(n²) render scans.
- **Tier 1 — make it a game (Phase B):** character HP + inventory (extend the effect vocabulary: `damage`/`heal`/`add_item`/`remove_item`), "search the remains" loot action, rest/camp action to advance time deliberately, 2–3 authored goals as a minimal win condition, and game-feel polish (travel animation, dice-tray journal rolls, encounter-spotlight keyboard shortcuts).
- **Tier 2 — combat MVP (Phase C):** party as a first-class persistent object decided on paper first; combat derived from the oracle (one deterministic trace); party-based turns, d20 attacks, damage, conditions; outcome written back through the oracle.
- **Tier 3 — DM toolsuite (Phase D):** form-based Build-mode editors (tables, then terrain/sites/encounters/evolution rules), world/session management UI, table lifecycle (diff/deprecation/release migration), session recap export, DM time controls, world forking for playtesting.
- **Tier 4 — later:** LLM narration strictly inside the narrator boundary, multiplayer/shared worlds, towns/dungeons/factions after combat proves out.
- **Strategic questions to settle before heavy engine work:** what brings the player back (working answer: character progression + a world that changed while away), party model shape, combat-from-oracle vs. beside-oracle, and content throughput as a metric (ROADMAP §5).

**Next work:** remaining Phase A fixes, then Phase B Tier 1, in thin vertical slices.

**Phase A progress (2026-09-26, same day):** the first stabilize slice shipped — store-side history filtering/pagination (`EventQuery` on the port, both adapters, migration `0003` indexes, `limit=0` route fix), the `getMap` N+1 fix, the client view split (`Views/Play.elm` 884→233 lines + `Views/Play/{Map,Encounter,Panels}.elm` + shared `Views/Components.elm`), and the test-helper dedupe. New coverage: `test/integration/historyJourney.ts` runs the same pagination/visibility journey against the memory adapter and real PostgreSQL. Test totals went 71→73 in the server block (two new history tests).
