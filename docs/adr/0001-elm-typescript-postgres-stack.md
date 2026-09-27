# ADR 0001: Elm client, TypeScript modular monolith, PostgreSQL

Status: accepted (first playable slice)

## Decision

- **Client:** Elm 0.19.1 (pinned via `client/package.json`, `elm@0.19.1-6`), one
  `Browser.element` application. No ports or JS interop are needed for the slice.
- **Server:** TypeScript on Node.js 22, a modular monolith split into
  `domain/` (pure rules), `application/` (commands, queries, orchestration),
  `infrastructure/` (stores, HTTP, migrations), and `http/` (routing).
- **HTTP framework:** none. A ~150-line router on `node:http` keeps runtime
  dependencies to `pg`, `ajv`, `ajv-formats`, and keeps request validation and
  the shared error envelope fully explicit. Revisit when the API surface grows.
- **Persistence:** PostgreSQL via Docker Compose (`docker-compose.yml`,
  `postgres:16-alpine`) with checked-in SQL migrations and a tiny runner
  (`server/src/infrastructure/migrate.ts`).
- **Test runner:** Node's built-in `node --test` against `tsc` output; Elm tests
  via `elm-test`; e2e via `node --test e2e/*.test.mjs` against a spawned server
  process.

## Consequences

- The store is a port (`Store`/`Tx`) with two adapters: PostgreSQL
  (`pgStore.ts`) and in-memory (`memoryStore.ts`). The in-memory adapter backs
  unit/integration tests and the documented `WORLDFORGE_STORE=memory` dev mode;
  both adapters enforce the same invariants (stream versions, optimistic
  concurrency, idempotency uniqueness).
- PostgreSQL integration tests run real server binaries through
  `embedded-postgres` (a test-only devDependency) so CI does not require
  Docker. Docker Compose remains the supported way to run a development
  database.
