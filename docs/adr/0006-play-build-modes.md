# ADR 0006: Play and build modes; party-turn combat direction

Date: 2026-09-26 · Status: Accepted

## Context

The client mixed running the game and authoring content in one surface: the
"creator tools" were a boolean overlay that replaced the play area, the setup
screen carried build-time policy toggles, and the battlefield was a third
screen with its own implicit edit behaviors. The product is a dungeon-master
toolsuite that walks the line between a TTRPG and a videogame, so the two
activities — running a session and building content — deserve first-class,
distinct modes.

The open PLAN §10 question was which tabletop ruleset a future combat system
would model.

## Decision

1. **Play and Build are the top-level interaction modes.** Play mode is the
   running game (map, travel, encounters, journal, battlefield). Build mode is
   authoring and inspection (roll tables, complete history, and later terrain,
   site, encounter, and evolution-rule editing). A persistent switch lives in
   the topbar; keyboard shortcuts are mode-scoped (`m`/`l`/`b` in Play, `p`/
   `Escape` back). The server-side session visibility policy still enforces
   what Build mode may do; the UI never decides.
2. **The battlefield keeps an internal Run/Arrange split** matching how a DM
   uses a battlemap: arrange the scene (tokens, obstacles, scale), then run it
   (select, move). Combat automation will land inside "Run".
3. **Combat will model an original-D&D/Whitebox-flavored ruleset** — not hard
   and fast, but the gist of it: **party-based turns rather than per-unit
   initiative**, d20-style resolution, and light rules. The combat core stays
   data-driven and ruleset-pluggable (stats and attack procedures live in
   content, like tables do), so recorded history never needs rewriting if the
   profile changes.
4. **Choosing "Fight" on a combat encounter opens the battlefield directly**
   with the antagonists placed as enemy tokens, instead of leaving the
   battlemap an unrelated button. The oracle resolution still records the
   canonical outcome; the board plays the scene out at token scale.

## Consequences

- `Build.elm` and `Setup.elm` are self-contained modules (own model/update);
  the main model holds only running-play state.
- Future content authoring (terrain, sites, encounters, evolution rules)
  extends Build mode instead of adding more overlays.
- Combat work should extend the battlefield's Run tools with initiative
  rounds, party turns, attacks, damage, and conditions — starting from the
  Whitebox profile above.
