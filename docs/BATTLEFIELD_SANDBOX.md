# Battlefield sandbox

Start a world, then choose **Open battlefield** from the exploration sidebar.
The battlefield is a tactical view of the current world space. Its large tiles
are smaller movement spaces within that world location. Both square-and-diamond
and hex worlds retain their chosen layout.

The initial board has a radius of four large tiles (nine across), a nominal
width of 45 feet, and a five-foot movement step. **Area scale** changes the
radius and step distance for that location. This scale is a sandbox setting;
overworld terrain travel time is still governed by the existing exploration
rules.

## Using it

- The tools split into **Run** and **Arrange**, matching how a DM uses a
  battlemap: set the scene up, then play it out.
- **Run** (the default): select a character or enemy, then click a numbered
  space. The route preview gives the path, step count, and distance. **Move to
  destination** commits it. **Remove selected** deletes a sandbox token.
  **Reset all movement** restores allowances without changing positions.
- **Arrange**: **Place token** adds a named character, enemy, or stationary
  object. Movement allowance is set when placing a token. Characters and
  enemies default to six steps. All tokens block other tokens, including
  friendly ones. **Obstacles** toggles blocking spaces. Remove a token (in Run)
  before blocking its space. **Area scale** changes the radius and step
  distance for that location; it is a sandbox setting, and overworld terrain
  travel time is still governed by the existing exploration rules.
- A cardinal step costs one move. Entering a corner diamond costs one move.
  Continuing to the diagonal square costs another. The server finds a shortest
  legal route around occupied spaces.
- Click a token or use the roster to select it. Board spaces are keyboard
  focusable and activate with Enter or Space.
- **Choosing Fight on a combat encounter opens this board automatically** and
  places the encounter's antagonists as one enemy token on the farthest free
  space (never duplicating an existing label). The oracle still resolves the
  canonical outcome; the board plays the scene out at token scale.
- **Return to world** and reopen to continue from the saved positions and movement
  allowances. **Reload battlefield** recovers the latest server state after a
  connection error or conflicting edit.

The board is scoped to the exploration session and world coordinate. Different
world locations and sessions have independent sandboxes. PostgreSQL keeps edits
across server restarts; memory mode loses them on restart. The application still
has no session-resume UI after a full page reload.

This is a movement sandbox: no attacks, initiative, automated enemies, combat
outcomes, line of sight, difficult terrain, or token-size rules yet. Objects and
obstacles are manually placed. The world location supplies the terrain label and
background color. Sandbox edits neither advance world time nor resolve pending
exploration encounters. Combat is the planned next step on the Run tools:
original-D&D/Whitebox-flavored, party-based turns (see
[ADR 0006](adr/0006-play-build-modes.md)).

## Implementation and API

- `server/src/domain/battlefield.ts`: pure validation, movement budget, and BFS
  routes using the existing grid topology.
- `server/src/application/battlefields.ts`: current-location boundary, optimistic
  version checks, command retries, and append-only battlefield snapshots.
- `client/src/Battle.elm`: isolated tactical screen, route preview, and controls.
  It renders legal destinations supplied by the server.
- `GET /api/v1/sessions/{sessionId}/battlefields/{q}/{r}` loads the current
  location's board. An unedited board is derived without writing an event.
- `POST` to the same URL takes `expectedVersion`, `commandId`, and `action`.
  Actions are `add`, `remove`, `move`, `obstacle`, `reset`, and `settings`.
  See OpenAPI and `contracts/json-schema/battlefield.json`.

Each successful edit appends one system event on
`battlefield:{sessionId}:{q},{r}`, containing the validated snapshot and command.
This uses both existing storage adapters without a new database migration.
Exact retries return the original result. A stale version returns 409; invalid
actions return 422. Sandbox events stay out of the public exploration log.
Large histories may eventually warrant a dedicated projection.

## Verification

The normal `npm test` suite includes pathfinding and validation tests plus the
same HTTP journey against memory and PostgreSQL stores. The journey checks
reopening, retries, conflicts, blocked moves, and separation from world state.
The memory journey also validates the response schema.

`e2e/playwright/battlefield.spec.ts` exercises token placement, corner movement,
obstacles, reopening, scale, keyboard activation, mobile layout, and hex worlds.
Run it with the Playwright setup described in `e2e/README.md`.
