# ADR 0005: Versioned JSON content and session-level visibility policy

Status: accepted (first playable slice)

## Decision

- Content is **versioned JSON** (not YAML), validated by JSON Schema in
  `contracts/json-schema/` plus semantic rules in the loader
  (`application/content.ts`): reference integrity, dice-range coverage and
  overlap, contiguous evolution bands, known terrains, known procedures.
- A table result may contain display text, tags, declarative effects
  (`log`, `add_fact`, `supersede_fact`, `add_site`), authored choices, an
  optional immediate nested-table reference, and an optional visual-asset
  reference. **No arbitrary executable code** — the effect vocabulary is a
  closed union interpreted in one place (`application/effects.ts`).
- Selection modes: deterministic weighted entries, and bounded dice
  expressions (`d6`, `2d6`, `2d6+1`) with inclusive result ranges that must
  cover every possible total.
- Worlds pin a content release string (`core@1.0.0`) at creation;
  resolutions record exact table versions.
- **Play view vs creator view** is a session-level visibility policy with
  category-level toggles: `tablePreview` (preview + publish) and
  `completeHistory` (unredacted events/traces). Discovery on the play map
  stays character-driven regardless of policy; creator tools never reveal
  undiscovered *world* state on the play endpoints — the server filters, not
  the UI.
- Map markers are projections of canonical state (sites + active facts),
  rendered as text glyphs with accessible labels, never color alone.

## Consequences

- Creators can add/validate/publish tables at runtime (`POST /api/v1/tables`)
  as new immutable versions without touching code.
- The first slice is a sandbox loop: no quests, progression, victory state,
  TTRPG combat, or autonomous simulation — and the model leaves room for
  rules components to be replaced later without rewriting recorded history.
