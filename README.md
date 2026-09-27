# Worldforge

Worldforge is an in-development engine for solo tabletop role-playing in a persistent, explorable world. Its first target is a visual hexcrawl where rules and procedural tables resolve play, and where the consequences of one visit can shape the next: abandoned loot may be taken, remains may attract monsters, or the dead may rise.

The longer-term aim is to let creators author and run their own worlds, procedures, tables, sites, factions, and lore, with multiplayer support built on the same history-aware world model.

## Current status

The app runs in two top-level modes ([ADR 0006](docs/adr/0006-play-build-modes.md)):
**Play** (map, travel, encounters, journal) and **Build tools** (roll-table
editing, validation, preview, publishing, complete history). Pending encounters
appear as a spotlight dialog; the journal follows the newest entries; and the
setup screen offers **Continue** for the last session (saved in the browser).

A **battlefield sandbox** is available from the current world space: place character, enemy, and object tokens, preview movement routes, add obstacles, and preserve positions when returning to exploration. Choosing **Fight** on a combat encounter opens the battlefield with the antagonists placed as enemy tokens. See [battlefield controls and current limits](docs/BATTLEFIELD_SANDBOX.md).

The setup screen now defaults to a **square grid with corner diamonds**, with the original hex board still available. Cardinal travel takes one step; diagonal travel stops on a shared corner diamond and takes two steps between large tiles. Layout is saved per world. See [board layouts and next modes](docs/BOARD_LAYOUTS.md).

**The first playable vertical slice is implemented and tested.** A local solo player can start a seeded finite world, travel across a lazy-generated axial hex map, resolve oracle encounters from deterministic nested roll tables, leave persistent facts behind, and watch world time evolve them — e.g. bandit remains that later attract scavengers, decay, or rise as undead. A creator view can inspect/edit tables, validate drafts, preview seeded rolls, publish immutable versions, and inspect the complete causal history.

What we're building next and how we work is in the [roadmap](./ROADMAP.md). Architecture decisions are in [docs/adr](./docs/adr); day-to-day commands are in [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md); the current implementation state and known-bad list are in [HANDOFF.md](./HANDOFF.md). The original [implementation plan](./PLAN.md) is retired and kept as a historical record.

## Quick start

```bash
# 1. Install server + client dependencies
npm run setup && cd client && npm install && cd ..

# 2. Start PostgreSQL (Docker) and run migrations — or skip to step 3 for the zero-dependency in-memory mode
npm run db:up

# 3. Build everything and start the server (serves API + client on http://localhost:4020)
npm run dev            # with PostgreSQL
npm run dev:memory     # without Docker: in-memory store, no persistence across restarts
```

Open <http://localhost:4020>, name a world and seed it, then travel with the arrow keys and Enter. Add `?fixtures=1` to the URL to explore a recorded demo session offline.

Run the whole verification suite:

```bash
npm test               # server unit+contract+integration (incl. real embedded PostgreSQL), Elm build+tests, e2e
npm run demo           # narrated transcript of the full consequence loop
```

## Product principles

- Mechanics and authored procedures decide canonical outcomes.
- Structured events preserve what happened and why.
- Random results store their seeds and content versions so they can be replayed.
- Persistent facts may be permanent, temporary, discoverable, or transformed by world time.
- The server protects undiscovered information; the UI does not merely conceal it.
- Content is data-first and versioned so creators can extend the world safely.
- Future LLM features narrate resolved facts or assist authors; they do not silently rewrite game state.

## Architecture

- **Frontend:** Elm 0.19.1
- **Backend:** TypeScript/Node.js modular monolith
- **Persistence:** PostgreSQL, using immutable domain events plus rebuildable read projections
- **Contracts:** OpenAPI 3.1 and JSON Schema
- **Content:** versioned terrain, tables, encounters, and evolution rules
- **Testing:** Elm tests, backend unit/integration tests (memory + real embedded PostgreSQL), cross-process e2e, and Playwright journeys

## Roadmap at a glance

Done: monorepo layout, contracts and fixtures, seeded world generation (hex + square-diamond), map/list/inspector/history, deterministic travel and table resolution with idempotency and concurrency safety, the bandits → remains → later-consequence loop, creator table tools, the battlefield movement sandbox, and the Play/Build mode split.

Next (see [ROADMAP.md](./ROADMAP.md) for the full plan):

1. **Stabilize** — server query scaling, client code cleanup, hygiene fixes.
2. **Make it a game** — character HP/inventory, looting, resting, authored goals, game-feel polish.
3. **Combat MVP** — party model, party-based turns, d20 resolution written back through the oracle (ADR 0006).
4. **DM toolsuite** — form-based content editors, world/session management, recap export, DM time controls, world forking.
5. Later, deliberately deferred — LLM narration inside the narrator boundary, multiplayer, towns/dungeons/factions.

## Repository today

```text
GameMaster/
├── client/               # Elm 0.19.1 application (Play and Build modes, fixture-backed offline mode)
│   ├── src/              # Main, State, Types (decoders), Api, Setup, Build, Battle,
│   │                     # Views/Play, BoardGrid + HexGrid geometry, Util, Fixtures (generated)
│   ├── tests/            # elm-test: contract decoders, API error envelope, hex/board geometry
│   └── public/           # index.html + styles.css + built main.js
├── server/               # TypeScript modular monolith
│   ├── src/domain/       # Pure rules: axial, grid (hex + square-diamond), rng, dice, tables,
│   │                     # hexgen, evolution, battlefield routing, validation — no I/O
│   ├── src/application/  # Commands (travel/oracle/battlefield), queries, history, effects,
│   │                     # projections, content loader, table services
│   ├── src/infrastructure/# Store port, PostgreSQL + in-memory adapters, SQL migrations
│   ├── src/http/         # node:http router, routes, error envelope, request ids
│   └── test/             # unit + contract (ajv) + integration tests (memory & real PostgreSQL)
├── contracts/            # OpenAPI 3.1, JSON Schemas (incl. battlefield), engine-generated fixtures
├── content/core/         # Versioned seed pack: terrain, worldgen, 12 tables, remains evolution
├── e2e/                  # Cross-process consequence-loop test, narrated demo, Playwright specs
├── docs/                 # ADRs 0001–0007, development guide, battlefield + board-layout docs
├── docker-compose.yml    # Local PostgreSQL only
├── ROADMAP.md            # Living roadmap: phases, backlog, working agreement
├── PLAN.md               # Retired 2026-09-26; historical record of the original delivery plan
├── HANDOFF.md            # Current implementation state + known-bad list
├── TTRPG Software.md     # Older research/idea notes; not a binding specification
├── new-ideas             # Newer concept notes; not a binding specification
└── README.md
```

## Working in parallel

In general, the frontend agent owns `client/**`, the backend agent owns `server/**`, and an integration owner controls shared contracts, seed content, root tooling, and end-to-end tests. Merge shared contracts and fixtures before starting dependent frontend/backend implementation.

Every handoff should include the scope covered, files changed, tests run, contract assumptions, and known limitations. See [ROADMAP.md §7](./ROADMAP.md#7-how-we-work) for the working agreement.

## Idea documents

The two existing notes are sources of possibilities, not requirements:

- [TTRPG Software.md](./TTRPG%20Software.md) explores many procedural systems, creator tools, simulation ideas, and a broad technical architecture.
- [new-ideas](./new-ideas) captures a more recent persistent shared-world concept and rules-first narrator boundary.

Implementation decisions should be judged against the playable vertical slice and revised from evidence as the project develops.
