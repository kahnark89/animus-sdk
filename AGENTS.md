# AGENTS.md — animus-sdk

## What this repo is
A Node.js/TypeScript SDK that implements the soul/mouth separation pattern for AI agents. The state engine runs locally and persistently; the LLM receives only a compiled mood-line paragraph.

## Repo structure
- `src/engine.js` — ALL state math, pure functions, UMD (runs in Node + browser simulator). No I/O here, ever.
- `src/index.js` — public `Animus` class: persistence (JSON db), wall-clock ticking, episodic memory.
- `src/index.d.ts` — hand-maintained type declarations (no build step).
- `bin/animus.js` — CLI (`init`, `simulate`, `status`). `simulate` inlines engine.js + the user schema into `templates/simulator.html`.
- `schema/agent.schema.json` — JSON Schema for agent state definitions
- `templates/` — files copied/compiled into user projects

## Core invariants (do not change without architect sign-off)
1. **The mood-line is the only interface between state engine and LLM.** The LLM never receives raw state variable values.
2. **State updates are driven by events, not by LLM output text.** The response is parsed for event tags; raw text never modifies state directly.
3. **The state engine runs offline.** No state update requires a network call.
4. **The schema is the user's file.** Never overwrite a user's `agent.schema.json` on `init` if one already exists.

## Development conventions
- Plain CommonJS JavaScript + hand-maintained `index.d.ts` — there is NO build step; never add one casually
- Zero runtime dependencies, anywhere
- engine.js stays pure and UMD: any I/O, fs, or Date.now() call belongs in index.js — the browser simulator depends on this split
- Coupling references EFFECTIVE (circadian-adjusted) setpoints, never raw baselines — see the comment in `step()`; regression here biases every coupled variable off equilibrium
- Tests: `npm test` (node --test, `src/__tests__/animus.test.js`) — deterministic via injected `now`/`rng`

## Key equations (reference)
```
x(t+1) = clamp01(
    x(t)
  + λ · (x₀_eff − x(t))
  + Σ κ_xj · (xj(t) − xj*)
  + event_kick(t)
  + ε(t)
)
```
λ ≈ 0.08 is the master homeostasis rate. Do not hard-code it — read from schema.
