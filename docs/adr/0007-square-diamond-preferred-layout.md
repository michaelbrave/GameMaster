# ADR 0007: Square-diamond is the preferred layout; hex remains supported

Date: 2026-09-26 · Status: Accepted

## Context

The engine ships two board layouts: the original pointy-top hex grid
([ADR 0002](0002-axial-coordinates-and-finite-world.md)) and a square grid with
corner diamonds ([BOARD_LAYOUTS.md](../BOARD_LAYOUTS.md)). Both share one API
(integer `q,r` doubled coordinates), one topology abstraction
(`domain/grid.ts`), and server-authoritative movement; the client mirrors only
drawing geometry (`BoardGrid.elm`). A world's layout is fixed at creation.

Playtesting prefers square-diamond: it reads more like the battlemaps and
dungeon grids DMs already use, the corner diamonds give diagonals an honest
two-step cost, and it extends naturally to interiors (rooms, corridors) in a
way pointy-top hexes do not.

## Decision

1. **Square-diamond is the default and preferred layout for new worlds** and
   the primary target when designing new features (battlefield combat, town
   and dungeon interiors, token-scale play).
2. **The hex grid remains a first-class option** at world creation. Existing
   hex worlds, fixtures, and API callers that omit `gridType` keep working.
3. **Compatibility rule:** any feature that depends on topology (movement,
   routing, area scale, line of sight later) must be implemented for both
   layouts through the shared grid abstraction — or its documentation must
   state explicitly that it is layout-specific and why. The server stays the
   sole authority on legal movement for both layouts.
4. The API keeps integer doubled coordinates for both layouts; no
   layout-specific coordinate systems are introduced.

## Consequences

- New UI affordances are tuned for square-diamond first (it is the default in
  the setup screen), then checked against hex.
- Tests that exercise topology run against both layouts, as the square-grid
  and battlefield suites already do.
- Interior maps (dungeons, towns) will use the square-diamond topology, which
  keeps one mental model from overworld to interior.
