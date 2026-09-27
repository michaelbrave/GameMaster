# ADR 0003: Immutable events, rebuildable projections, replayable resolutions

Status: accepted (first playable slice)

## Decision

- All state changes are **append-only events** in one envelope: id, worldId,
  streamId + streamVersion, global seq, type, schemaVersion, worldTick,
  recordedAt, actor, location (axial), causationId, correlationId, visibility
  (`public` | `system`), payload.
- Facts never mutate history. When a fact evolves, a new linked event is
  appended (`fact_superseded` with the successor fact; `causationId` points at
  the event that created the source fact).
- Projections (`hex_projections`, session/world rows) are rebuilt from events.
  `application/projection.ts` implements rebuilds, and tests assert
  **rebuild == incremental** on both store adapters.
- Every command resolution is stored with its seed context, every rolled
  value (weighted roll + total weight, or dice expression + individual dice),
  the selected entries, and the emitted event ids. Nested table rolls belong
  to the same trace with increasing depth.
- Randomness derives from `sha256(worldSeed | contentRelease | purpose |
  context…)` feeding mulberry32, so a stored trace replays bit-for-bit.
  Hex materialization depends only on world seed + content release + axial
  coordinate; command rolls add the destination and the pre-command session
  version as a nonce, never random session ids.
- Commands carry **idempotency keys** (unique per session) and
  **expectedVersion** optimistic checks. A retried key returns the stored
  response without rerolling; a stale version returns `version_conflict`.

## Consequences

- The play-view log is a rendering of public events; the creator view shows
  the full unredacted stream when the session policy allows it.
- No background simulation exists: evolution runs lazily inside commands when
  relevant time advances or a hex is loaded, and is idempotent per (fact,
  band) via `evaluatedBands` on the fact.
