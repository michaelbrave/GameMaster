# Define time-banded fact evolution

Type: grilling
Status: closed (2026-09-26) — the first playable slice is complete and shipped; see ROADMAP.md for current priorities. Kept as historical design guidance.
Blocked by: 02, 04

## Question

How does a persistent fact such as bandit remains select its evolution procedure, apply elapsed world-time bands, resolve nested outcome tables, avoid duplicate evaluation, and emit traceable state changes when time advances or a hex loads?
