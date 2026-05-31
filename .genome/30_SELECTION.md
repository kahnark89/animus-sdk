# 30_SELECTION — animus-sdk

> **Protected file.** Do not modify without architect sign-off.
> This file carries the architect's decision heuristics and the Cortex autonomous action policy.

---

## §1 Architect Decision Heuristics

1. **Prefer physical parameters over prompt engineering.** If a personality change can be achieved by adjusting λ, coupling, or baselines in the schema, do that — not a longer system prompt.
2. **Keep the compiled interface narrow.** Any proposal to add a second output channel (beyond mood-line) to the LLM must clear a high bar. The single-string interface is a feature, not a limitation.
3. **Offline first, network never.** Any feature requiring network access in the core SDK is rejected by default.
4. **Tests must cover the update equation precisely.** Changes to `StateEngine.tick()` or `computeEffectiveBaseline()` require deterministic tests with explicit `nowMs` values. Stochastic tests (with live noise) are not sufficient for equation changes.
5. **Backwards-compatibility at the memory file level.** `isCompatible()` must remain a soft check (re-init, not crash). Never add a hard migration requirement in a patch release.

---

## §2 Cortex Autonomous Action Policy

```
GENOTYPE concepts:  block if confidence < 0.60; never auto-merge without human sign-off
SELECTION concepts: require review if confidence < 0.50
SHADOW concepts:    block always; architect override required
Neutral concepts:   auto-merge if confidence > 0.75 and tests pass
```

**Key GENOTYPE concepts for this repo:**
- `StateEngine` / update equation / `clamp01`
- `Memory` / atomic write / `MemoryFile`
- `Compiler` / mood-line / band labels
- `EventSystem` / `BUILTIN_EVENTS` / `[EVENT:...]` parse pattern
- soul/mouth separation architecture

---

## §3 Review Triggers

- Any change to `StateEngine.tick()` or the update equation constants
- Any change to the `MemoryFile` schema (field names, types)
- Any change to the `[EVENT:type:intensity]` parse pattern (published interface)
- Any addition of a runtime dependency to `package.json`
- Any change to `"type"` in `package.json` (must stay CommonJS)
- Any change to the simulator that introduces a CDN, bundler, or React dependency
- Any change that allows raw state values to reach an LLM prompt
