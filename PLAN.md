# Worldforge implementation plan

> **Retired 2026-09-26.** This plan carried the project through the first playable vertical slice, which is complete. **[ROADMAP.md](./ROADMAP.md) is the living planning document** — phases, backlog, and working agreement now live there. This file is kept as a historical record of the original architecture and delivery plan; where it conflicts with current code, the ADRs, or ROADMAP.md, those win.

> Status: working architecture and delivery plan. This document is intentionally narrower than the long-term idea notes. Update it when a vertical slice teaches us something.

> **Implementation update (2026-07-30):** the first playable vertical slice is implemented and tested (see README Quick start and docs/adr). Where this plan and the Wayfinder handoff disagreed, the handoff won:
>
> - **Seeded lazy hex generation replaces the hand-authored first region** (SH-004). Worlds are finite axial hex regions (`regionRadius`) materialized deterministically from the world seed + pinned content release on first entry. `content/core` provides generation tables, not a fixed map.
> - The **first-slice scope is a sandbox loop**: no quests, progression, victory state, TTRPG combat, or autonomous simulation. Evolution runs lazily on time advance / hex load, not via background jobs.
> - Concrete stacks chosen: `node:http` router (no web framework), `node --test`, JSON content (not YAML), `embedded-postgres` for dockerless pg integration tests (Docker Compose remains the dev database), `embedded` fixture generation from real engine output.
> - Delivered: monorepo layout (Phase 0), contracts + fixtures + contract tests (SH-003/SH-101/SH-201 family), pure domain modules with unit tests, travel + oracle + choice commands with idempotency/optimistic concurrency (BE-201/203/204 family), time-banded fact evolution with the bandits→remains→consequence scenario covered by integration, pg, and cross-process e2e tests (Phase 3 goal), accessible Elm play view + creator tools (FE-* family: map+list parity, keyboard travel, trace view, table editor/validator/preview, complete-history view).
> - Deferred deliberately: Playwright browser journey (spec scaffold in `e2e/`, browsers not installed in this environment), save/restore UX beyond session persistence, multi-world management UI, table lifecycle beyond "publish new immutable version".

## 1. Product direction

Worldforge is a rules-first engine for solo tabletop role-playing in a persistent, shared, explorable world. A player should be able to enter a region, travel across hexes, consult procedures and random tables, resolve an encounter, and leave consequences that can affect later visits. In time, creators should be able to author and run their own worlds with the same tools.

The first meaningful demonstration is this chain:

1. A player opens a small authored region and sees only what their character has discovered.
2. They move into a neighboring hex.
3. The server resolves travel and a weighted encounter table from a reproducible random seed.
4. The player resolves the encounter through a small set of explicit actions.
5. The engine records immutable events and updates the hex's current state.
6. A later visit sees a consequence derived from that history—for example, dead bandits attract scavengers, leave recoverable loot, decay, or return as undead.
7. A creator can inspect the event chain and edit the tables that made it possible.

That slice proves the project's distinctive idea before combat depth, LLM narration, economies, or large-scale simulation are added.

## 2. Design principles

- **Procedures are authoritative.** Rules, tables, player choices, and explicit state transitions decide what happened.
- **History is structured data.** Narrative text may describe an event, but it is not the canonical event.
- **Consequences are traceable.** A derived condition such as `scavenger_activity` links back to the event(s) that caused it.
- **Randomness is replayable.** Store the seed, selected table version, inputs, and result for every procedural resolution.
- **Persistence has limits.** Not every footprint lasts forever. Facts declare visibility and persistence rules; world time may transform or expire them.
- **Discovery is separate from existence.** The server can know a site exists without revealing it to every character.
- **Content is data-first.** Tables, terrain definitions, encounter templates, and evolution rules are versioned content rather than hard-coded UI behavior.
- **LLMs present, propose, and assist.** They may narrate resolved facts or help draft content, but they do not silently mutate canon or overrule mechanics.
- **Start local and modular.** A modular monolith and one database are enough for the first playable releases.
- **Design for accessibility.** Map interactions need keyboard, text-list, and non-color-only equivalents.

## 3. Scope boundaries

### First playable release

- One local development world, one region, and a modest axial hex map.
- One player character and one active play session.
- Terrain, movement cost, time advancement, discovery, and a travel procedure.
- Versioned weighted tables, chained table rolls, deterministic seeds, and a roll trace.
- A small encounter/action loop that can create persistent consequences.
- Append-only world events plus current-state projections for hexes.
- A hex detail/history view and a minimal table editor with validation and preview rolls.
- Save/reload behavior and automated tests for the bandit-remains scenario.

### Deliberately later

- LLM narrator, chronicler, semantic search/RAG, and natural-language intent routing.
- Full tactical combat, system-specific character sheets, magic, crafting, and economies.
- Dungeon maps, settlement simulation, autonomous NPC schedules, factions, and dynasties.
- Multiple simultaneous players, hosted creator worlds, permissions, moderation, and marketplaces.
- Git-like branching/merging of live worlds, offline synchronization, and CRDTs.
- 3D presentation, animated characters, and high-fidelity terrain generation.

These are valid directions, not commitments to put every idea into one release.

## 4. Proposed architecture

Keep the existing Elm client and add a TypeScript backend. Revisit this choice only after the vertical slice; changing both the product model and the frontend stack at once adds little learning value.

```text
Elm web client
  map / play / history / table editor
              |
       versioned JSON API
              |
TypeScript modular monolith
  commands | procedures | tables | world time | projections
              |
         PostgreSQL
  events | projections | authored content | sessions
```

Recommended initial choices:

| Area | Choice | Reason |
| --- | --- | --- |
| Web client | Elm 0.19.1 | Already scaffolded; strong domain modeling and safe UI state |
| API | TypeScript on Node.js, with a small HTTP framework | Shared JSON-schema tooling and a large testing ecosystem |
| Contracts | OpenAPI 3.1 plus JSON Schema | Language-neutral contract for Elm and TypeScript |
| Database | PostgreSQL | Transactions, JSONB where useful, constraints, and a path to pgvector later |
| Migrations | A checked-in SQL migration tool | Reviewable schema evolution; exact library can be selected during bootstrap |
| Testing | Elm tests, backend unit/integration tests, Playwright smoke tests | Covers pure rules, persistence, and the player journey |
| Local runtime | Docker Compose for PostgreSQL only | Reproducible storage without premature service orchestration |

Redis, queues, Kubernetes, a vector database, and a separate rule-engine language are not needed until measured behavior calls for them.

### Suggested repository layout

```text
GameMaster/
├── client/                 # Elm application (move src/, public/, elm.json here in Phase 0)
├── server/                 # TypeScript API and domain modules
│   ├── src/domain/         # Pure rules and domain types
│   ├── src/application/    # Commands, queries, orchestration
│   ├── src/infrastructure/ # PostgreSQL, HTTP, clocks, RNG adapters
│   └── test/
├── contracts/              # OpenAPI, JSON schemas, examples
├── content/                # Seed region, tables, terrain, evolution rules
├── e2e/                    # Cross-stack user journeys
├── docs/                   # Architecture decisions and domain notes
├── PLAN.md
└── README.md
```

Phase 0 owns the directory move. Until that task lands, other agents should not independently rearrange the repository.

## 5. Core domain model

Use UUIDs for persistent identities and ISO 8601 UTC instants for real time. World time should be an explicit integer tick or calendar value, never inferred from wall-clock time.

| Model | Minimum fields / responsibility |
| --- | --- |
| `World` | `id`, `name`, `currentTick`, ruleset/content release references |
| `Region` | `id`, `worldId`, name, bounds, generator/authorship metadata |
| `Hex` | `id`, `regionId`, axial `q/r`, terrain, elevation/tags, base content reference |
| `Site` | Persistent point within a hex; type, tags, discoverability, current status |
| `Character` | Identity, current hex, known hex/site IDs, minimal travel resources |
| `PlaySession` | Character, world, status, started/ended ticks, last acknowledged event |
| `TableDefinition` | Stable ID, version, purpose, input tags, entries, lifecycle status |
| `TableEntry` | Weight/range, conditions, result payload, optional child-table reference |
| `Resolution` | Seed, command, inputs, table versions, rolls, selected results, emitted event IDs |
| `WorldEvent` | Stream/version, type, tick, actor, location, payload, causation/correlation IDs, visibility |
| `HexProjection` | Quickly readable current view built from base hex data plus applicable events |
| `EvolutionRule` | Conditions over tags/events and time; emits a proposed deterministic transition |

### Event envelope

All state-changing domain events use one envelope. Payload schemas are selected by `type` and `schemaVersion`.

```json
{
  "id": "uuid",
  "worldId": "uuid",
  "streamId": "hex:uuid",
  "streamVersion": 12,
  "type": "remains_created",
  "schemaVersion": 1,
  "worldTick": 184,
  "recordedAt": "2026-07-30T20:00:00Z",
  "actor": { "type": "character", "id": "uuid" },
  "location": { "regionId": "uuid", "hexId": "uuid", "siteId": null },
  "causationId": "uuid",
  "correlationId": "uuid",
  "visibility": "discoverable",
  "payload": {
    "kind": "bandit_corpses",
    "count": 4,
    "tags": ["fresh", "lootable"],
    "persistence": { "mode": "evolves", "nextEvaluationTick": 208 }
  }
}
```

Do not put rendered prose, client layout, or an entire mutable world snapshot in this envelope.

### State-changing command pipeline

1. Receive a command with an idempotency key and expected stream/world version.
2. Authenticate/identify the session (development identity is acceptable in the first slice).
3. Load the required projections and exact content versions.
4. Validate movement, permissions, preconditions, and command schema.
5. Derive or accept a deterministic random seed.
6. Resolve rules and tables as pure functions, producing a roll trace and proposed events.
7. Append events and the resolution record in one database transaction.
8. Update/rebuild affected projections in that transaction for the modular monolith.
9. Return the new versions, resolved facts, player-visible events, and projection changes.

Use optimistic concurrency (`expectedVersion`) to reject two incompatible writes. Do not introduce CRDTs for authoritative game actions. A retried idempotency key must return the original result, not roll again.

### How semi-persistent hex history works

The current hex view is a projection of:

```text
authored/generated baseline
+ permanent facts
+ active temporary/evolving facts
+ consequences derived by world-time rules
- hidden facts the viewing character has not discovered
```

Example evolution chain:

```text
encounter_resolved: bandits defeated
  -> remains_created: fresh + lootable
  -> time_advanced
  -> evolution_evaluated (seed and rule version recorded)
     -> scavengers_attracted + remains_partially_consumed
        OR remains_reanimated
        OR valuables_removed
```

Each transition is a new event. Never rewrite `remains_created`; expire or supersede it through a linked event. World evolution should initially run only when relevant time advances or a hex is loaded, and must be idempotent for the same rule, source fact, and evaluation window.

## 6. API boundary for parallel work

Contract files and example fixtures are the handshake between frontend and backend. Frontend work uses fixtures/mocks until endpoints exist; backend work validates responses against the same schemas.

Initial endpoints:

| Method and path | Purpose |
| --- | --- |
| `POST /api/v1/worlds` | Create a development world from a seed content pack |
| `GET /api/v1/worlds/{worldId}` | World metadata and current tick |
| `GET /api/v1/sessions/{sessionId}/map` | Session-filtered map summary; discovery policy is enforced server-side |
| `GET /api/v1/sessions/{sessionId}/hexes/{q}/{r}` | Player-visible current projection; undiscovered hexes return 404 |
| `GET /api/v1/sessions/{sessionId}/history` | Filtered, paginated event history |
| `POST /api/v1/sessions` | Start/resume a play session |
| `POST /api/v1/sessions/{sessionId}/commands/travel` | Resolve travel, time, discovery, and travel events |
| `POST /api/v1/sessions/{sessionId}/commands/encounter-action` | Apply one explicit encounter choice/action |
| `GET /api/v1/tables` | List table definitions and versions |
| `POST /api/v1/tables/validate` | Validate an uncommitted table draft |
| `POST /api/v1/tables/preview` | Produce seeded preview rolls without world mutation |
| `POST /api/v1/tables` | Create a new immutable published table version |

Every error response should contain `code`, `message`, `requestId`, and optional structured `details`. Define at least `validation_failed`, `not_found`, `version_conflict`, `command_rejected`, and `content_version_missing`.

WebSockets are unnecessary for the first single-player slice. Add server-sent events or WebSockets when multiple connected viewers or long-running jobs actually exist.

## 7. Delivery roadmap and task ownership

Task IDs are stable coordination handles. `SH-*` changes shared contracts or cross-stack behavior; merge those before dependent frontend (`FE-*`) and backend (`BE-*`) tasks. Each phase should end in a runnable, demonstrable increment.

### Phase 0 — foundation and decisions

Goal: two agents can work without repeatedly editing the same files.

#### Shared / integration

- [ ] **SH-001** Record architecture decisions for axial hex coordinates, event-plus-projection persistence, world-time ticks, and the Elm/TypeScript/PostgreSQL stack.
- [ ] **SH-002** Move the current Elm scaffold under `client/`; add root scripts for format, lint, test, and development startup.
- [ ] **SH-003** Create `contracts/` with OpenAPI 3.1, shared error schema, ID/timestamp conventions, example map/hex/history/session payloads, and contract validation in CI.
- [ ] **SH-004** Create a tiny, versioned `content/core` pack with terrain definitions, a hand-authored test region, a travel table, a bandit encounter, and remains evolution rules.
- [ ] **SH-005** Add CI jobs that run frontend, backend, contract, and later end-to-end checks independently.

#### Frontend

- [ ] **FE-001** Establish the Elm application shell, routing, remote-data states, error presentation, responsive layout, and accessible theme tokens. Depends on SH-002.
- [ ] **FE-002** Build an API boundary with typed decoders/encoders and a fixture-backed development implementation. Depends on SH-003.

#### Backend

- [ ] **BE-001** Bootstrap the TypeScript server with configuration validation, structured logs, request IDs, health endpoint, formatting, linting, and tests.
- [ ] **BE-002** Add PostgreSQL development setup, migrations, transaction helper, and isolated integration-test database.
- [ ] **BE-003** Validate and load versioned content packs without writing game-specific branches into the loader. Depends on SH-004.

Exit criteria: one command documents how to start the client, server, and database; both apps pass CI; the fixture response and server response validate against the same contract.

### Phase 1 — read-only world explorer

Goal: view a small world and understand a hex before any gameplay mutation.

#### Shared / integration

- [ ] **SH-101** Freeze v1 contracts for world metadata, bounded hex summaries, hex detail, discovery state, terrain legend, and paginated history.
- [ ] **SH-102** Add fixture worlds covering unknown, discovered, visited, hazardous, and site-bearing hexes.

#### Frontend

- [ ] **FE-101** Render a pan/zoom axial hex map with terrain, selection, current position, fog/unknown state, and keyboard navigation.
- [ ] **FE-102** Add a non-map list view containing equivalent travel and discovery information.
- [ ] **FE-103** Build a hex inspector with terrain, sites, active facts/tags, last-visited tick, and loading/empty/error states.
- [ ] **FE-104** Build a chronological history panel that distinguishes observed facts from rumors or hidden/redacted events.

#### Backend

- [ ] **BE-101** Implement world, region, hex baseline, site, and discovery persistence.
- [ ] **BE-102** Import the seed region idempotently from `content/core`.
- [ ] **BE-103** Implement projection queries and the world/hex/history endpoints with viewport bounds and pagination.
- [ ] **BE-104** Enforce server-side visibility filtering so undiscovered secrets never reach the client.

Exit criteria: a new world can be seeded and explored from both the visual map and accessible list; API tests prove undiscovered site data is absent, not merely hidden by CSS.

### Phase 2 — deterministic travel and tables

Goal: take a legal step and see exactly how the engine decided its outcome.

#### Shared / integration

- [ ] **SH-201** Freeze v1 schemas for commands, table definitions, conditions/results, roll traces, resolutions, and emitted event summaries.
- [ ] **SH-202** Specify axial adjacency, terrain costs, impassable terrain, time cost, seed derivation, and table chaining limits with executable examples.

#### Frontend

- [ ] **FE-201** Add travel preview: reachable neighbors, cost, destination summary, and confirmation.
- [ ] **FE-202** Submit travel commands with idempotency and expected-version fields; handle retry, rejection, and version conflict without duplicate actions.
- [ ] **FE-203** Present resolution facts and an expandable, plain-language roll trace.
- [ ] **FE-204** Update map position, fog, clock, and hex inspector from the command response without requiring a full reload.

#### Backend

- [ ] **BE-201** Implement a deterministic RNG abstraction and weighted/chained table evaluator as pure functions.
- [ ] **BE-202** Implement table conditions, result payload validation, cycle detection, maximum depth, and immutable table versions.
- [ ] **BE-203** Implement travel validation, terrain/time cost, discoveries, idempotency, optimistic concurrency, and atomic event append.
- [ ] **BE-204** Persist complete resolution traces and expose only player-safe trace data.
- [ ] **BE-205** Add property/fuzz tests for table boundaries and deterministic replay across many seeds.

Exit criteria: repeating a recorded resolution with the same content versions and seed yields the same result; retrying the HTTP command creates no additional events; illegal movement changes nothing.

### Phase 3 — persistent consequences vertical slice

Goal: demonstrate that one visit materially changes a later visit.

#### Shared / integration

- [ ] **SH-301** Define the first encounter state machine: `presented -> active -> resolved`, with flee/engage/search actions and explicit results.
- [ ] **SH-302** Define event payloads and evolution rules for defeated bandits, remains, loot, scavengers, stripped remains, and reanimation.
- [ ] **SH-303** Write the canonical end-to-end scenario and fixed seeds before implementation.

#### Frontend

- [ ] **FE-301** Build encounter presentation from structured facts, available actions, mechanical stakes, and status—not generated prose.
- [ ] **FE-302** Build the action/result loop and prevent stale or duplicate submissions while a command is pending.
- [ ] **FE-303** Add active consequences and provenance links to the hex inspector (for example, “scavengers came because remains were left here”).
- [ ] **FE-304** Add a developer timeline view showing event type, tick, causation, correlation, and resolution ID.

#### Backend

- [ ] **BE-301** Implement the encounter state machine and command handlers with allowed-action validation.
- [ ] **BE-302** Append outcome, remains, and loot events atomically and update the hex projection.
- [ ] **BE-303** Implement deterministic, idempotent evolution evaluation when world time crosses a rule window or a relevant hex loads.
- [ ] **BE-304** Link every derived event to source events and the exact evolution rule/content version.
- [ ] **BE-305** Implement projection rebuild from baseline plus event stream and verify it matches incrementally maintained projections.

Exit criteria: the automated scenario defeats bandits, leaves, advances time, returns, and observes a seeded consequence; rebuilding from the event log produces the identical visible hex state.

### Phase 4 — creator table tools

Goal: a non-programmer can safely change travel outcomes without editing application code.

#### Shared / integration

- [ ] **SH-401** Define draft/published/deprecated content lifecycle, immutable version behavior, validation diagnostics, and export format.
- [ ] **SH-402** Provide examples for simple, conditional, and chained tables plus compatibility rules for existing worlds.

#### Frontend

- [ ] **FE-401** Build table list/search and a structured table editor for purpose, entries, weights, conditions, payloads, and chaining.
- [ ] **FE-402** Show inline schema and semantic validation, total weights/probabilities, unreachable entries, cycles, and broken references.
- [ ] **FE-403** Build seeded preview rolls with distribution summaries and full trace inspection.
- [ ] **FE-404** Add an explicit publish/version confirmation and read-only comparison between versions.

#### Backend

- [ ] **BE-401** Implement draft validation for schema, references, cycles, conditions, payload compatibility, and safe evaluation limits.
- [ ] **BE-402** Implement preview rolls as read-only operations that cannot emit world events.
- [ ] **BE-403** Implement immutable publication, deprecation, version listing, and content-pack export/import.
- [ ] **BE-404** Preserve referenced old versions so existing event/resolution histories remain replayable.

Exit criteria: edit a copy of the travel table, preview it with a fixed seed, publish a new version, use it in a new world, and still replay history created with the old version.

### Phase 5 — hardening and first usable release

Goal: a solo player can trust saves and a creator can diagnose content behavior.

#### Shared / integration

- [ ] **SH-501** Threat-model hidden information, malicious content payloads, oversized tables, and unauthorized world access.
- [ ] **SH-502** Create backup/restore and schema/content migration runbooks.
- [ ] **SH-503** Run the complete browser journey in CI and publish a versioned sample world.

#### Frontend

- [ ] **FE-501** Add a new/resume world flow, session recovery, route-level errors, and empty states.
- [ ] **FE-502** Complete keyboard and screen-reader review; test map/list feature parity and reduced motion.
- [ ] **FE-503** Add client diagnostics export with secrets and hidden world facts excluded.

#### Backend

- [ ] **BE-501** Add development authentication first, then world roles (`owner`, `gamemaster`, `player`, `viewer`) before hosted multiplayer.
- [ ] **BE-502** Add authorization tests at every query/command boundary and redact hidden facts from logs.
- [ ] **BE-503** Add database backup/restore verification, migration tests, rate/size limits, and graceful shutdown.
- [ ] **BE-504** Measure map query, event append, projection rebuild, and table evaluation performance; optimize only observed bottlenecks.

Exit criteria: the sample world survives restart and restore; permissions and hidden data pass adversarial tests; the core browser journey passes reliably.

### Phase 6 — expansion candidates, chosen by playtesting

Do not schedule all of these at once. Choose the next vertical slice based on what players and creators actually need:

- Dungeon/site exploration using the same event, table, and discovery primitives.
- A configurable ruleset adapter and deeper encounter/combat procedure.
- Region/hex/site visual authoring, generator pipelines, and undoable drafts.
- Faction clocks and event directors that emit inspectable, deterministic world events.
- NPC, settlement, item provenance, rumor, quest, and lore generators.
- Optional LLM narration from a strict packet of canonical facts, with a mechanical fallback renderer.
- Shared worlds with invitations, privacy, conflict handling, live GM intervention, and moderation/audit tools.
- Creator packaging, dependency/version management, publishing, and community content review.

## 8. Parallel agent working agreement

Use this section when delegating tasks.

### File ownership

- Frontend agent owns `client/**` and frontend-specific documentation/tests.
- Backend agent owns `server/**`, migrations, and backend-specific tests.
- Contract/integration owner controls `contracts/**`, `content/core/**`, root scripts, CI, and end-to-end tests.
- `PLAN.md`, architecture decisions, and shared schemas require integration review.

An agent may propose a contract change in its branch, but dependent work should not treat it as final until the integration owner accepts it.

### Handoff packet for every task

Each completed task should report:

1. Task ID and acceptance criteria covered.
2. Files and migrations changed.
3. Commands/tests run and their results.
4. Contract assumptions or deviations.
5. Known limitations, follow-ups, and screenshots for visible UI work.

### Integration order

1. Merge the phase's `SH-*` contracts and fixtures.
2. Backend and frontend implement independently against those artifacts.
3. Run contract tests against real backend responses.
4. Switch the frontend feature from fixture transport to HTTP.
5. Merge the phase's end-to-end scenario.
6. Demo and record decisions before expanding scope.

Prefer thin vertical pull requests over one large “frontend” branch and one large “backend” branch. Database migrations are append-only after they have been shared; fix them with a new migration.

## 9. Definition of done

A task is done only when:

- Its acceptance behavior is implemented and demonstrated.
- Domain logic has focused unit tests; persistence/API changes have integration tests; critical journeys have end-to-end coverage.
- New or changed payloads validate against checked-in contracts and examples.
- Errors, loading, empty, authorization, and hidden-information behavior are handled where relevant.
- Formatting, static checks, migrations, and tests pass from documented commands.
- Documentation and content versions are updated with the code.
- No LLM-generated text or client-only state is required to reconstruct canonical mechanical facts.

## 10. Open decisions to resolve early

Capture outcomes as short architecture decision records rather than letting separate implementations decide implicitly.

- Exact TypeScript HTTP framework, query/migration library, and test runner.
- World tick scale and calendar presentation.
- Whether the initial authored content format is JSON, YAML, or a restricted combination.
- How a world pins or upgrades its content release.
- Minimum character/travel-resource model needed for meaningful travel.
- Which tabletop ruleset, if any, the first encounter models versus using a deliberately system-neutral procedure.
- Naming: keep “Worldforge,” select another product name, or treat it as a working title.

## 11. Success measures

For the first playable release, favor proof of behavior over audience-scale metrics:

- 100% deterministic replay for stored resolutions in the test corpus.
- No duplicate events from command retries.
- Projection rebuilds match incremental projections in automated tests.
- No undiscovered facts appear in player API payloads, logs, or diagnostics.
- A creator can add and validate a table outcome without changing code.
- A returning player can identify what changed in a hex and why.
- The complete bandit-remains-return scenario is covered by one automated browser test and one backend integration test.

## 12. How the idea notes were used

[`TTRPG Software.md`](./TTRPG%20Software.md) and [`new-ideas`](./new-ideas) are research and ideation inputs. This plan adopts their strongest recurring themes—data-driven generators, persistent event history, creator tools, a rules-authoritative narrator boundary, and eventual shared worlds—while intentionally deferring their more complex infrastructure and feature proposals until the core hexcrawl loop proves useful.
