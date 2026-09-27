# Board layouts

Choose **Square grid with corner diamonds** (the default in the setup screen) or
**Hex grid** when creating a world. A world's layout is saved and cannot be
switched during play. Existing saves, offline fixtures, and API callers that
omit `gridType` retain hex behavior.

The square layout has large squares with clipped corners. Four clipped corners
surround one small diamond that is a real, shared stopping space.

- North, south, east, west: one step between large tiles.
- Diagonals: one step onto the corner diamond, then another onto a large tile.
- Each large tile has eight neighbors; each diamond has four.
- Each stop uses the existing terrain cost, discovery, encounter, and history
  rules. This is exploration movement, not yet D&D combat movement.
- The faint board outline reveals geometry only. Undiscovered terrain, sites,
  and facts remain hidden.

The map, hover details, accessible list, and travel buttons use the same
server-authorized destinations. Arrow keys cycle destinations; Enter travels.

## Representation

The API keeps integer `q,r` coordinates and the existing `hexes` field and
location endpoints for compatibility. For `square-diamond`, both coordinates
even means a large tile; both odd means a diamond. Mixed parity is invalid.
Thus (0,0) → (2,0) is east, while (0,0) → (1,1) → (2,2) is southeast.
The finite board has large tile centers from -radius to +radius in each axis,
encoded as doubled coordinates, with diamonds between them.

`server/src/domain/grid.ts` owns adjacency and bounds. Terrain generation,
travel validation, and map queries consult the saved layout. The client mirrors
only drawing geometry in `BoardGrid.elm`; the server supplies legal moves.
PostgreSQL migration 0002 adds the layout with a hex default for existing rows.

## Next modes

The intended direction is a dungeon master toolsuite. After playtesting this
board, the next candidates are:

1. Combat: the [battlefield sandbox](BATTLEFIELD_SANDBOX.md) now supports tokens,
   movement budgets, and obstacles. The ruleset direction is decided
   ([ADR 0006](adr/0006-play-build-modes.md)): original-D&D/Whitebox-flavored,
   party-based turns rather than per-unit initiative. Next: party turns,
   attacks, damage, conditions, and encounter completion; each diamond
   transition already costs one full step.
2. Town generation: settlements, services, NPCs, shops, and persistent locations.
3. Monster dens and dungeons: rooms, connections, inhabitants, encounters,
   treasure, and links between exploration locations and interior maps.

Combat resolution and generators remain future systems. Board topology is separate
from movement costs so later combat rules can reuse either layout.
