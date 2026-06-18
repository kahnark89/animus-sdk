# 30_SELECTION — animus-sdk

> **Protected file.** Do not modify without architect sign-off.
> This file carries the architect's decision heuristics and the autonomous action policy.

---

## §1 Architect Decision Heuristics

1. **Prefer physical parameters over prompt engineering.** If a personality change can be achieved by adjusting λ, coupling, baselines, or noise in the schema, do that — not a longer system prompt.
2. **Keep the compiled interface narrow.** Any proposal to add a second output channel (beyond the mood-line string) to the LLM must clear a high bar. The single-string interface is a feature, not a limitation.
3. **Offline first, network never.** Any feature requiring network access in the core SDK (`src/`, `bin/`) is rejected by default.
4. **Tests must cover the update equation precisely.** Changes to `stepFirst()`, `stepSecond()`, or `runSteps()` require deterministic tests with injected `nowMs`. Stochastic tests (live noise, no seed) are not sufficient for equation changes.
5. **Backwards-compatibility at the state file level.** Missing fields default gracefully (e.g., `rev` → 0, `baselineShifts` → `{}`). Never add a hard migration requirement in a patch release.
6. **Idempotency over mutation.** Methods called multiple times (e.g., `_applyBaselineShifts`, `normalizeSchema`) must produce the same result on repeated calls. Prefer recomputing from canonical source over accumulating on existing values.
7. **One process-global exit handler, never per-instance.** Exit flush must iterate the dirty-instance registry, not install one listener per `Animus` instance.

---

## §2 Autonomous Action Policy

```
GENOTYPE concepts:  block if confidence < 0.60; never auto-merge without human sign-off
SELECTION concepts: require review if confidence < 0.50
SHADOW concepts:    block always; architect override required
Neutral concepts:   auto-merge if confidence > 0.75 and tests pass
```

**Key GENOTYPE concepts for this repo:**
- `stepFirst` / `stepSecond` / update equation / `clamp01`
- `FileStore` / atomic write / state file schema
- `compile()` / mood-line / band labels / `DEFAULT_BANDS`
- `eventsToKicks` / `KICK_TABLE` / `[[event]]` parse pattern
- Soul/mouth separation architecture
- `_baseBaselines` / idempotency invariant

---

## §3 Review Triggers

- Any change to `stepFirst()`, `stepSecond()`, or the update equation constants
- Any change to the state file schema (`.animus/<id>.json` field names or types)
- Any change to the `[[event:type:intensity]]` parse pattern (published interface)
- Any addition of a runtime dependency to `package.json` or any `packages/*/package.json`
- Any change to `"type"` in `package.json` (must stay CommonJS)
- Any change to the simulator that introduces a CDN, bundler, or React dependency
- Any change that allows raw state values to reach an LLM prompt
- Any change to `_applyBaselineShifts()` — must be accompanied by a regression test
- Any citation added to `engine.js` or `playground/index.html` — verify the paper exists and is relevant before merging

---

## §4 Engine API Stability Contract (v2.x)

The following engine.js exports are stable public API. Do not remove or rename without a major version bump:

| Export | Signature |
|--------|-----------|
| `stepFirst` | `(state, noiseState, schema, nowMs, kicks) → {state, noiseState}` |
| `stepSecond` | `(state, velocityState, noiseState, schema, nowMs, kicks) → {state, velocityState, noiseState}` |
| `runSteps` | `(state, velocityState, noiseState, schema, nowMs, steps, kicks) → {state, velocityState, noiseState}` |
| `compile` | `(state, schema, nowMs, prevState?, memories?, opts?) → string` |
| `eventsToKicks` | `(events, schema) → Record<Var, number>` |
| `parseEvents` | `(text, extraTypes?) → {type, intensity}[]` |
| `inferEvents` | `(text) → {type, intensity}[]` |
| `driftSetpoints` | `(baselineShifts, schema, elapsedDays) → baselineShifts` |
| `diagnose` | `(state, velocityState, noiseState, schema, nowMs) → DiagnosticResult` |
| `band5` | `(x: number) → 'very_low'|'low'|'mid'|'high'|'very_high'` |
| `VARS` | `string[]` — always `['mood','energy','curiosity','affection','focus']` |
| `clamp01` | `(x: number) → number` |
| `DEFAULT_BANDS` | phrase pool fallback |

> **These signatures are the ground truth taken from `src/engine.js`.** `schema` sits in the
> middle of the step functions (after the carry-state objects), which is unusual — do not assume
> a `(state, schema, …)` order. The mismatch between an earlier version of this table and the real
> engine is what produced the simulator regression (see `40_SHADOW.md` S006/S010). Any edit to this
> table or to the engine signatures **must** be accompanied by a passing run of
> `src/__tests__/simulator.test.js`, which executes the generated simulator headlessly and asserts
> the call order matches. If that test and this table ever disagree, the test wins.

The simulator template (`templates/simulator.html`) is the canonical reference consumer of this API,
and `src/__tests__/simulator.test.js` enforces that it actually runs against the real engine.
