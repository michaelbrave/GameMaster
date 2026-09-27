# Worldforge

The vocabulary for Worldforge's persistent, solo tabletop exploration domain.

## Language

**Solo player**:
The person playing a single character in one locally run world during the first playable slice. This person may also author that world's content.
_Avoid_: User, multiplayer participant

**Creator**:
The solo player when inspecting or authoring versioned world content, such as procedures and tables. It is a capability of the same local person, not a separate role in the first slice.
_Avoid_: Admin, game master

**Oracle procedure**:
A small, authored multiple-choice procedure that resolves a situation deterministically from its inputs and seed. It is the first slice's encounter mechanism, not a combat or character-rules system.
_Avoid_: Combat engine, TTRPG ruleset

**Rules component**:
A replaceable, versioned definition of a procedure, table, or rule set that determines game outcomes. Later experiments with statistics or combat must be able to replace or compose these components without rewriting recorded history.
_Avoid_: Hard-coded game logic

**Roll table**:
A versioned text/JSON rule definition that selects a result from weighted or ranged entries using a deterministic seed. Roll tables are the foundational gameplay-content format.
_Avoid_: Hard-coded encounter list

**Nested table**:
A roll-table result that references another roll table for additional resolution. Each nested selection is part of the same recorded resolution trace.
_Avoid_: Separate random encounter

**Table result**:
A validated roll-table outcome containing display text, tags, state/event effects, optional nested-table reference, optional player choices, and an optional visual-asset reference. It cannot contain arbitrary executable code.
_Avoid_: Scripted result

**Visual asset**:
A referenced image or icon used to present a canonical table result or map marker. It is presentation metadata, not an independent source of game state.
_Avoid_: Visual-only game data

**Generated hex**:
An axial-map hex whose initial terrain, sites, and facts are deterministically resolved from a world's seed and versioned generation content when exploration reaches it. Once materialized, its facts persist and are not regenerated on revisits.
_Avoid_: Randomly recreated hex

**Fact evolution**:
A later, traceable change to a persistent fact, resolved by that fact's own procedure using elapsed world-time bands and nested outcome tables.
_Avoid_: Background simulation, mutable event rewrite

**Resolution trace**:
The human-readable, replayable record of one resolved command: its player choice, seed, table versions and selections, emitted events, and resulting state. It is shown as a text log, with deeper detail available to the creator.
_Avoid_: Narrative-only transcript

**Map marker**:
A simple stationary icon projecting a player-visible site, unit, or world condition onto a hex map. It reflects canonical world state and is not independently authoritative.
_Avoid_: Map-only state

**Play view**:
The interface and API representation filtered to what a character is allowed to discover under the active visibility policy.
_Avoid_: Full world view

**Creator view**:
The interface for inspecting and editing authored content and the complete world history. In local solo play it may be enabled alongside the play view, but it remains semantically distinct.
_Avoid_: Separate user role

**Visibility policy**:
The session-level configuration that determines how much creator information a play view reveals. It applies by content category or table, including roll previews, rather than by individual hex, item, or location.
_Avoid_: Discovery state, per-object visibility setting
