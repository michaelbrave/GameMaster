# ADR 0002: Axial coordinates and a finite hex world

Status: accepted (first playable slice)

## Decision

- Hexes use **axial coordinates** `(q, r)` with pointy-top layout. The six
  neighbor offsets are fixed constants (`domain/axial.ts`), and distance uses
  the cube-manhattan metric `(|dq| + |dr| + |dq+dr|) / 2`.
- The world is **finite**: a hex-shaped region of radius `regionRadius`
  (core pack: 2 → 19 hexes) centered on the origin. A hex is inside when
  `max(|q|, |r|, |q+r|) <= radius`.
- The origin is the home hex, materialized at world creation with the
  configured home terrain; every other hex is materialized lazily and
  deterministically from `(world seed, content release, q, r)` on first entry
  (or first travel attempt into it).
- Materialization is a one-time event (`hex_materialized`); the stored
  projection is never regenerated on revisits. Future regions can attach at
  the boundary later without changing the model (new region, new radius, same
  coordinate scheme).

## Consequences

- "Unknown" hexes do not exist in the database until entered; the play API
  returns only discovered hexes, so undiscovered state cannot leak.
- Travel legality is purely geometric: neighbors only, inside the radius,
  terrain passable after materialization. Impassable destinations become
  discovered but do not move the character and cost no time.
