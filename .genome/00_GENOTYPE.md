# 00_GENOTYPE — animus-sdk

> **Protected file.** Do not modify without architect sign-off.
> Any commit modifying this file must include `GENOTYPE-CHANGE: <reason>` in the commit message.
> Log the authorization in `20_EPIGENOME.md` after making the change.

---

## §1 Project Thesis

animus-sdk is a persistent AI state layer that decouples an agent's soul (continuous emotional/cognitive state) from the LLM (the mouth that speaks). The state engine runs locally, offline, and independently of any specific model. The LLM receives exactly one compiled interface: the mood-line paragraph. This architecture makes agent personality vendor-independent, session-persistent, tunable by physics rather than prompting, and owned by the developer rather than rented from a model provider.

---

## §2 Architecture Invariants

1. **Soul/mouth separation is absolute.** The LLM never touches state directly. `agent.compile()` is the only bridge — it produces the mood-line and nothing else crosses that boundary.
2. **State lives in `animus/agent.memory.json`.** The memory file is plain JSON. Not a database, not binary, not `.db`. Writes are atomic: write to `.tmp` then `fs.renameSync`.
3. **Zero runtime dependencies.** The published package uses only Node.js built-ins. No third-party runtime imports in `src/` or `bin/`.
4. **CommonJS output only.** TypeScript compiles to `"module": "CommonJS"`. No `"type": "module"` in `package.json` — bin files use `require()`.
5. **Update equation is canonical.** `x(t+1) = clamp01(x + λ(x₀_eff − x) + Σκ(xj − xj*) + kick + ε)`. λ, coupling κ, and circadian are schema-defined. The equation must not change without a GENOTYPE-CHANGE commit.

---

## §3 Design Principles

1. **Tuned by physics, not prompting.** λ (homeostasis rate), coupling κ, circadian peaks, and noise magnitude are the knobs. Persona changes happen here, not in the system prompt.
2. **Offline-first.** State reads and writes are synchronous filesystem operations. No network calls in the core SDK.
3. **Graceful degradation.** If memory file is missing or incompatible, the engine silently re-initialises from schema baselines. Never crash on missing state.
4. **Simulator is deliberately isolated.** `simulator/simulator.js` duplicates StateEngine logic inline. It has no build pipeline and must run as `file://`. This duplication is intentional — the simulator is a diagnostic tool, not a production code path.

---

## §4 Hard Lines (Non-Negotiables)

1. **Never inject raw state values into LLM prompts.** Only the compiled mood-line string enters the prompt. Raw `{ mood: 0.73 }` values are for debugging/simulator only.
2. **No CDN, no React, no bundler in the simulator.** The simulator must work offline as a plain `file://` HTML file.
3. **`agent.memory.json` schema must remain backwards-compatible** or increment the file format version. A schema variable list mismatch triggers silent re-init, never a crash.
4. **No `"type": "module"` in package.json.** The CLI uses `require()` and must stay CommonJS.

---

## §5 Schema Commitments

`MemoryFile` shape (agent.memory.json):
```typescript
{
  schemaName: string;       // must match agent.schema.json "name"
  variables: string[];      // must match agent.schema.json "variables" (order-independent)
  state: AgentState;        // { values, noise, tick, timestamp }
  growth: { delightCount: number; sessionCount: number };
  savedAt: number;          // epoch ms
}
```

`AgentState` shape:
```typescript
{ values: Record<string, number>; noise: Record<string, number>; tick: number; timestamp: number; }
```

The `[EVENT:type]` and `[EVENT:type:intensity]` inline event format is a published interface. Changing the regex breaks integrations.

---

## §6 Security Model

animus-sdk is a local developer tool. It reads/writes only within the paths explicitly configured by the developer (`schema`, `memory` config options). The CLI accepts no network input. The simulator serves files only from `simulator/` and `cwd/animus/` — path traversal is blocked by the `!file.includes('..')` guard in the http server.

---

## §7 Aliveness Test

"Does the agent feel different across sessions based on what actually happened, without the developer having written any extra prompting?"
