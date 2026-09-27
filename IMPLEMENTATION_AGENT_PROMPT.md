# Worldforge implementation handoff

> **Historical (2026-09-26).** This prompt produced the first playable vertical slice, which is complete. The task IDs and PLAN.md references below describe that effort; current priorities and the working agreement live in [ROADMAP.md](./ROADMAP.md). Kept for provenance.

You are the implementation agent for Worldforge. Begin building the first playable vertical slice now. You do not have the Wayfinder skill, so use the documents and instructions below as the source of truth and make reasonable implementation decisions within these boundaries.

## Read first

Read these files before editing:

1. [`README.md`](./README.md) — product overview and current repository state.
2. [`PLAN.md`](./PLAN.md) — existing architecture and delivery plan.
3. [`CONTEXT.md`](./CONTEXT.md) — canonical domain vocabulary.
4. [`TTRPG Software.md`](./TTRPG%20Software.md) and [`new-ideas`](./new-ideas) only for background; they are not binding requirements.
5. [Wayfinder map](./.scratch/worldforge-first-playable-spec/map.md) — agreed scope and unresolved design areas.
6. The decision tickets in [the Wayfinder issues directory](./.scratch/worldforge-first-playable-spec/issues/) — use them as design guidance, not as a reason to stop implementation.

## Destination

Build a demonstrable, local, solo procedural hex-crawl vertical slice:

1. A player starts in a seeded finite axial-hex world.
2. Exploring an ungenerated neighboring hex deterministically materializes its terrain/sites/initial facts and persists them.
3. Travel advances explicit world time and records discovery.
4. A deterministic weighted or dice-based nested roll-table resolution produces an oracle-style encounter.
5. The player chooses from a small set of authored options.
6. The engine appends immutable events, stores a replayable resolution trace, and updates current projections.
7. A later visit can observe a consequence, such as bandit remains evolving into scavenger activity, partial decay, or reanimation through fact-specific time-banded nested tables.
8. The interface presents a readable text log, an axial map, and simple stationary state-derived markers.
9. A minimal creator-assisted view can inspect/edit tables, validate drafts, preview seeded rolls, and inspect history.

The first release is a sandbox loop. It has no quests, progression, victory state, full TTRPG rules, tactical combat, or autonomous simulation.

## Non-negotiable design constraints

- Use Elm 0.19.1 for the client, TypeScript/Node.js for a modular-monolith backend, PostgreSQL for persistence, and Docker Compose only for local PostgreSQL.
- Keep the repository modular: `client/`, `server/`, `contracts/`, `content/`, `e2e/`, and `docs/` as described in `PLAN.md`. Move the existing Elm scaffold as part of foundation work, preserving behavior.
- Mechanics and authored procedures are authoritative. LLMs, if added later, may narrate resolved facts but must not mutate canon.
- Content is versioned text/JSON. A table result may contain display text, tags, state/event effects, an optional nested-table reference, authored choices, and an optional visual-asset reference. It must not contain arbitrary executable code.
- Initially support deterministic weighted selection and bounded dice expressions (`d6`, `2d6`, `2d6+1`). Store every random value in the trace.
- Nested table selections belong to the same resolution trace.
- Use immutable events plus rebuildable projections. Never rewrite an old event when a fact evolves; append a linked event.
- Commands use idempotency keys and optimistic expected-version checks. Retrying an idempotency key returns the original result without rerolling.
- A generated hex is materialized once from the world seed and versioned generation content, then persists on revisits.
- Evolution is fact-first: `fact category -> fact evolution procedure -> elapsed-time band -> nested outcome table -> new events`. Make evaluation idempotent for a source fact and evaluation window.
- Separate `play view` from `creator view`. The local solo player may toggle creator assistance through a session-level visibility policy. Initially provide category-level controls for roll-table preview and complete-history inspection. Discovery remains character-driven.
- Map markers are projections of canonical state, not independent state. Keep visual assets simple and referenced rather than building an asset pipeline.
- Accessibility matters: map information needs keyboard/text-list equivalents and cannot rely on color alone.

## How to work

Start with a runnable foundation, then implement one vertical slice end to end. Prefer small, tested increments over scaffolding that cannot demonstrate behavior.

Recommended order:

1. Inspect the existing Elm shell and repository; preserve unrelated user changes.
2. Establish the monorepo layout and root development commands.
3. Bootstrap the TypeScript server, configuration validation, logging, request IDs, health endpoint, formatting, linting, and tests.
4. Add PostgreSQL migrations and an isolated integration-test database.
5. Define OpenAPI/JSON Schema contracts and fixtures for world, hex, session, travel, resolution traces, history, tables, and errors.
6. Implement pure domain modules first: axial coordinates, seeded RNG/dice, weighted/nested table resolution, discovery, oracle choices, event envelopes, and fact evolution.
7. Implement persistence and projections transactionally, including idempotency and optimistic concurrency.
8. Implement the API endpoints and a fixture-backed Elm API boundary.
9. Build the accessible map, text log, travel/choice flow, table editor/validator/preview, and creator-assisted history view.
10. Add an end-to-end test for generated hex → travel → nested encounter → choice → remains → time advancement → later consequence.

Use the existing task IDs in `PLAN.md` when practical, but update the plan where it conflicts with the decisions above—especially the shift from a hand-authored first region to seeded lazy hex generation. Do not silently expand scope to multiplayer, LLM routing, Redis, queues, Kubernetes, CRDTs, or full combat.

## Completion standard

Do not stop at directory scaffolding. The repository should have a documented command to start the client, server, and database; automated tests for pure rules and persistence; validated shared contracts; and a runnable demonstration of the complete consequence loop. Report what was implemented, tests run, assumptions made, and any genuinely unresolved decisions.
