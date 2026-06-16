# 00_GENOTYPE — animus-sdk

> **Protected file.** Do not modify without architect sign-off.
> Any commit modifying this file must include `GENOTYPE-CHANGE: <reason>` in the commit message.
> Log the authorization in `20_EPIGENOME.md` after making the change.

---

## §1 Project Thesis

animus-sdk is a persistent affective state layer that decouples an agent's soul (continuous emotional/cognitive state) from the LLM (the mouth that speaks). The state engine runs locally, offline, and independently of any specific model. The LLM receives exactly one compiled interface: the mood-line paragraph. This architecture makes agent personality vendor-independent, session-persistent, tunable by physics rather than prompting, and owned by the developer rather than rented from a model provider.

---

## §2 Architecture Invariants

1. **Soul/mouth separation is absolute.** The LLM never touches state directly. `agent.compile()` is the only bridge — it produces the mood-line string and nothing else crosses that boundary.
2. **State lives in `.animus/<id>.json`** (default). The file is plain compact JSON. Writes are atomic: write to a per-process unique `.tmp` file then `fs.renameSync` to the final path.
3. **Zero runtime dependencies.** `src/`, `bin/`, and all `packages/*` use only Node.js built-ins and each other. No third-party runtime imports in any shipped file.
4. **CommonJS output only.** No `"type": "module"` in `package.json` — bin files use `require()` and must stay CommonJS.
5. **Update equation is canonical.** First-order path: `x(t+1) = clamp01(x + λ(x₀_eff − x) + Σκ(xj − xj*) + kick + ε)`. Second-order path adds damped harmonic velocity. λ, coupling κ, and circadian are schema-defined. The equation must not change without a GENOTYPE-CHANGE commit.
6. **The five state variables are fixed:** `mood`, `energy`, `curiosity`, `affection`, `focus`. The `variables` field in user schemas is decorative (validated-and-warned, not dynamically wired).
7. **`engine.js` is pure and UMD.** No I/O, no `Date.now()`, no `fs` calls inside engine.js — it runs identically in Node.js, browser, and edge runtimes. All I/O and wall-clock time belong in `index.js`.

---

## §3 Design Principles

1. **Tuned by physics, not prompting.** λ (homeostasis rate), coupling κ, circadian peaks, noise magnitude, and baseline shifts are the knobs. Personality changes happen in the schema, not the system prompt.
2. **Offline-first.** State reads and writes are local filesystem operations (or injected Store). No network calls in the core SDK.
3. **Graceful degradation.** If the state file is missing or corrupt, the engine re-initialises from schema baselines and preserves the corrupt file as `<file>.corrupt-<ts>`. Never crash on missing or bad state.
4. **Pluggable persistence.** The default `FileStore` uses atomic tmp-rename writes. Any object implementing `{load, save, saveSync}` is a valid Store. CAS (`cas(key, db, expectedRev)`) is optional but enables multi-writer safety.
5. **Write-behind by default.** State mutations (compile/apply/gist/remember) coalesce into one non-blocking write per event-loop turn via `setImmediate`. A single process-global exit hook flushes all dirty instances — never per-instance exit listeners, to avoid `MaxListenersExceededWarning` on servers with many instances.

---

## §4 Hard Lines (Non-Negotiables)

1. **Never inject raw state values into LLM prompts.** Only the compiled mood-line string enters the prompt. Raw `{ mood: 0.73 }` values are for debugging/simulator only.
2. **No CDN, no React, no bundler in the simulator.** The generated `animus/simulator.html` must work offline as a plain `file://` HTML file.
3. **`.animus/<id>.json` schema must remain backwards-compatible** or handle missing fields gracefully. A missing `rev` field is silently defaulted to 0. Never require a migration step in a patch release.
4. **No `"type": "module"` in package.json.**
5. **`_baseBaselines` is the idempotency anchor.** `_applyBaselineShifts()` always recomputes from `this._baseBaselines` (captured at construction from the normalized schema), never from `this.schema.baselines`. Do not change this without adding a regression test.

---

## §5 State File Shape (`.animus/<id>.json`)

```typescript
{
  rev:            number;           // monotonic counter; 0 on first write
  state:          Record<Var, number>;  // current values, clamped [0,1]
  noiseState:     Record<Var, number>;  // OU process carry
  velocity:       Record<Var, number>;  // second-order damped oscillator carry
  baselines:      Record<Var, number>;  // effective baselines (schema + shifts)
  baselineShifts: Record<Var, number>;  // accumulated growth/drift deltas
  setpoints:      Record<Var, number>;  // effective homeostasis targets
  lastTick:       number;               // epoch ms of last tick
  memories:       string[];             // episodic gist strings (recent first)
  eventLog:       {type, intensity, ts}[];
}
```

The `[[event]]` / `[[event:intensity]]` inline tag format is a published interface. Changing the regex breaks integrations.

---

## §6 Security Model

animus-sdk is a local developer tool. It reads/writes only within the paths explicitly configured by the developer (`schema`, `memory`/`store` options). The CLI accepts no network input. The simulator HTML is a static file opened locally — no server is spawned.

---

## §7 Aliveness Test

"Does the agent feel different across sessions based on what actually happened, without the developer having written any extra prompting?"
