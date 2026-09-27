# ADR 0004: Explicit world time and time-banded fact evolution

Status: accepted (first playable slice)

## Decision

- World time is an **integer tick**, advanced only by travel (terrain move
  cost), never by wall-clock time. Real timestamps (`recordedAt`) exist only
  for diagnostics.
- Evolution is **fact-first**:
  `fact category -> evolution procedure -> elapsed-time band -> nested outcome
  table -> new events`.
- An evolution rule (versioned content, see `content/core/evolutions/`)
  declares contiguous bands over elapsed ticks since fact creation, each
  pointing at a roll table. Example: remains are fresh for 0–2, ripen at 3–7,
  and are old at 8+.
- Evaluation happens when a hex is entered/loaded and the world tick has
  advanced: every due band is evaluated **once**, in order, with a
  deterministic seed (`worldSeed | release | "evolution" | factId | band`).
  Evaluated band indexes are recorded on the fact, making evaluation
  idempotent for a source fact and evaluation window; catch-up across several
  bands evaluates each in order and stops when the fact is superseded.
- Outcome effects use the declarative `supersede_fact`/`add_fact`/`log`
  vocabulary; the successor fact carries the traceability chain.

## Consequences

- The signature scenario works: bandit remains left behind can, on a later
  visit, have attracted scavengers (`scavenger_activity`), been picked clean,
  decayed to bones/dust, or risen as undead — each a new linked event, the
  original `fact_created` event untouched.
