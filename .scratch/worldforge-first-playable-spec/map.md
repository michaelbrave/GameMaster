# Worldforge first-playable specification map

Type: wayfinder:map

## Destination

An implementation-ready specification for Worldforge's first playable vertical slice: a local solo procedural hex crawl with replayable, persistent consequences and minimal table authoring. The map is complete when no product, domain, or interface decision needed to implement that slice remains unresolved.

## Notes

- This is a planning-only effort; do not implement product code through this map.
- Consult `/grilling` and `/domain-modeling` for every decision ticket. `CONTEXT.md` is the project glossary.
- The first actor is a local solo player who may use creator capabilities; multiplayer, roles, and permissions are later work.
- Gameplay is data-first, layered text/JSON roll tables. They can nest, contain authored choices/effects/assets, and use only deterministic weighted selection and bounded dice expressions; no arbitrary content scripts.
- The first slice is an oracle-style choice loop, not a partial TTRPG combat system. Rules components must be versioned and replaceable for future experiments.
- The player experience is a text log plus axial-hex map and state-derived stationary markers. A hybrid session configuration controls table preview and complete-history inspection; discovery still controls the play map.
- Use an Elm client, TypeScript modular monolith, PostgreSQL, and Docker Compose only for local PostgreSQL.
- Worlds are seeded, finite, procedurally populated hex crawls. Generated hexes persist and later regions may connect without changing the model.
- The first slice is a sandbox exploration loop with no progression system or win state.

## Decisions so far

<!-- Closed child tickets appear here as one-line context pointers. -->

## Not yet specified

- Exact first-slice acceptance scenarios and the minimum sample world/content required to demonstrate them.
- Validation, reference integrity, and publication lifecycle for the table/content format.
- The final public contract and event payload vocabulary required by the Elm client, API, and persistence layer.
- Accessibility and interaction details for the map, text log, keyboard use, and creator-assisted controls.
- Exact finite-world boundary and how future regions connect beyond it.
- Delivery sequencing, migrations, testing strategy, and operational bootstrap once the product/domain decisions are settled.

## Out of scope

- Multiplayer, accounts, roles, and permissions.
- Full tactical combat, character sheets/stats, magic, crafting, economies, quests, progression, and win conditions.
- Autonomous unit turns, continuous simulation, pathfinding, and background world jobs.
- Arbitrary scripting in content, visual map painting/editing, procedural-world-generator UI, and map asset pipelines beyond referenced static assets.
- LLM narration/routing, RAG, semantic search, WebSockets, queues, Redis, Kubernetes, CRDTs, hosted creator worlds, and marketplaces.
