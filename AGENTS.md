# AGENTS.md — animus-sdk

## What this repo is
A Node.js/TypeScript SDK that implements the soul/mouth separation pattern for AI agents. The state engine runs locally and persistently; the LLM receives only a compiled mood-line paragraph.

## Repo structure
- `bin/animus.js` — CLI entry point (`animus init`, `animus simulate`, `animus status`)
- `schema/agent.schema.json` — JSON Schema for agent state definitions
- `src/` — SDK source (state engine, compiler, memory, adapters, event system)
- `templates/` — files copied into user projects by `animus init`

## Core invariants (do not change without architect sign-off)
1. **The mood-line is the only interface between state engine and LLM.** The LLM never receives raw state variable values.
2. **State updates are driven by events, not by LLM output text.** The response is parsed for event tags; raw text never modifies state directly.
3. **The state engine runs offline.** No state update requires a network call.
4. **The schema is the user's file.** Never overwrite a user's `agent.schema.json` on `init` if one already exists.

## Development conventions
- TypeScript strict mode
- No runtime dependencies beyond Node.js built-ins for the CLI
- SDK core (state engine, compiler) has zero LLM-provider dependencies — adapters are separate
- Tests live in `src/__tests__/`

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
