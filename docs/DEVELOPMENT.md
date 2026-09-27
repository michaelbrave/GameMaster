# Worldforge development guide

Day-to-day commands and a tour of the moving parts. Architecture decisions live in [adr/](./adr).

## Setup

```bash
npm run setup                 # server dependencies
cd client && npm install      # client toolchain (pins elm 0.19.1 + elm-test)
```

## Run

```bash
npm run dev          # docker-compose PostgreSQL + build + server on :4020
npm run dev:memory   # same, but with the in-memory store (no Docker needed)
```

The server serves both the JSON API and the built Elm client at
`http://localhost:4020`. Open `http://localhost:4020/?fixtures=1` for the
offline fixture-backed demo (recorded real engine output, read-only).

Environment variables (validated at boot, see `server/src/config.ts`):
`PORT` (4020), `WORLDFORGE_STORE` (`pg`|`memory`), `DATABASE_URL`,
`CONTENT_DIR` (`content/core`), `CLIENT_DIR` (`client/public`), `LOG_LEVEL`.

## Test

```bash
npm test                 # everything below, from the repo root
npm run test:server      # server unit + contract + integration tests
                         # (in-memory store AND real embedded PostgreSQL;
                         #  WORLDFORGE_SKIP_PG=1 skips the pg suite)
npm run test:contracts   # fixtures + live responses vs JSON Schema, OpenAPI sanity
npm run test:client      # elm make (typecheck the whole client)
cd client && npx elm-test  # Elm unit tests (decoders against engine fixtures)
npm run test:e2e         # spawn a real server process, play the whole loop over HTTP
npm run demo             # print a narrated transcript of the consequence loop
```

Regenerate contract fixtures after changing responses:

```bash
npm run fixtures         # writes contracts/fixtures from a real engine run
cd client && node gen-fixtures.mjs   # re-bundles them for the Elm offline mode
```

## Database

```bash
npm run db:up            # docker compose up -d postgres (postgres:16, localhost:5432)
npm run db:migrate       # apply server/migrations/*.sql (also runs at server boot)
npm run db:down          # stop and remove the container
```

Migrations are append-only. The schema is one `events` table (append-only,
`UNIQUE(stream_id, stream_version)`), projection tables (`hex_projections`,
`worlds`, `sessions`, `discoveries`), `resolutions`
(`UNIQUE(session_id, idempotency_key)`), and `content_tables`
(`PRIMARY KEY(id, version)` — immutable versions).

## How a command flows

1. `http/routes.ts` maps the request to an application service.
2. `application/commands.ts#prelude` loads the session, checks the
   idempotency key (stored responses replay without rerolling) and the
   optimistic `expectedVersion`.
3. Pure domain modules resolve everything: `hexgen` materializes new hexes
   from the world seed, `tables` rolls the oracle with a per-command seed,
   `evolution` finds due time bands for evolving facts.
4. `application/effects.ts` interprets the closed effect vocabulary into new
   facts/sites/logs; `EventFactory` assigns stream versions.
5. One transaction appends events, updates projections, bumps versions, and
   stores the resolution trace + response. Any failure rolls everything back.

## Testing invariants worth knowing

- Two worlds with the same seed produce identical roll traces for identical
  command sequences (`replay of stored resolutions…`).
- Projection rebuilds from events deep-equal incremental projections on both
  store adapters.
- Undiscovered hexes return 404 and never appear in map/history payloads.
- Retried idempotency keys return byte-identical responses with no new events.
- Every fixture in `contracts/fixtures` and every live response validates
  against the checked-in JSON Schemas; every content table validates against
  the table-definition contract.
