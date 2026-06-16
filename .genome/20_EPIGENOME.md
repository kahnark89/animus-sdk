# 20_EPIGENOME — animus-sdk

> **Append-only decision log.** Never edit or delete existing entries.
> Add new entries at the bottom. Each entry: date, decision, rationale, who.

---

## [2026-05-31] Initial architecture — soul/mouth separation

**Decision:** State engine and LLM are separate systems connected by one compiled string (the mood-line). The LLM never receives raw numeric state values.

**Rationale:** Raw values (`{ mood: 0.73 }`) would invite the LLM to reason about them, defeating the purpose of compilation. The mood-line is a semantic boundary — the LLM responds to it as language, not as data.

**Author:** Capps Consulting / initial build session

---

## [2026-05-31] Memory format: JSON over binary/DB

**Decision:** State file is plain compact JSON. The `.db` extension referenced in early drafts was rejected.

**Rationale:** Plain JSON is human-readable, debuggable without tooling, diffable in git, and trivially portable. No query capabilities are needed — the full state object is small (< 2KB for typical schemas).

**Author:** claude/cortex-animus-repos-eV8MC

---

## [2026-05-31] Atomic write pattern

**Decision:** All writes go to a per-process unique `.tmp` file, then `fs.renameSync` to the final path.

**Rationale:** Prevents corrupt state files if the process is killed mid-write. `renameSync` is atomic on POSIX and near-atomic on Windows (same drive). The per-process unique suffix avoids two instances clobbering the same `.tmp`.

**Author:** claude/cortex-animus-repos-eV8MC

---

## [2026-05-31] Simulator: Canvas 2D, no CDN, no bundler

**Decision:** The generated `animus/simulator.html` uses plain Canvas 2D API with the real engine inlined. No React, no bundler, no CDN imports.

**Rationale:** Must work as `file://` with no internet connection and no build step. CDN React breaks offline. The simulator is a diagnostic/demo tool — it does not need a production UI framework.

**Author:** claude/cortex-animus-repos-eV8MC

---

## [2026-05-31] Circadian affects `energy` only (default)

**Decision:** Default `circadian.applies_to = ['energy']`. Other variables feel the circadian rhythm indirectly via coupling from energy.

**Rationale:** Applying it directly to all variables would create unphysical correlations and reduce the schema's expressiveness. Schema authors can override `applies_to` to include other variables.

**Author:** claude/cortex-animus-repos-eV8MC

---

## [2026-06-16] v2.1.0 — pluggable persistence + multi-writer safety + fidelity

**Decision:** Four phases shipped together as a minor bump (2.0.0 → 2.1.0):
- P0: schema normalization + validation (`src/normalize.js`); schema-aware event parsing; `confusion` built-in; README + scaffold fixed.
- P1: pluggable Store layer (`FileStore`, `MemoryStore`); write-behind with process-global exit flush; `flush()`/`flushSync()`/`close()`; `Animus.open()`.
- P2: true Gaussian (Box–Muller) noise; compiler anti-repetition (opt-in; byte-identical without `opts.recent`).
- P3: monotonic `rev`, CAS on both stores, `AnimusConflictError`, `onConflict` policy.

**Rationale:** All changes are backwards-compatible at the API level. The one behavior change (writes are now write-behind by default) is soft: `save:'sync'` restores the previous guarantee. Minor bump is correct semver. Original 42 engine tests are unchanged.

**Author:** claude/animus-handoff-review-eo9utx

---

## [2026-06-16] `_applyBaselineShifts` idempotency fix

**Decision:** Capture pristine baselines in `this._baseBaselines` at construction and recompute `schema.baselines[v] = clamp01(base + shift)` on every call instead of accumulating.

**Rationale:** The original implementation read from the already-mutated `schema.baselines[v]` and added `shift` again, causing runaway saturation toward 0/1 over a long-lived session. Stored state was never corrupted (shifts in `db.baselineShifts` stayed bounded); damage was in-memory only and self-healed on reload. Two regression tests added in `fidelity.test.js`.

**Author:** claude/animus-handoff-review-eo9utx

---

## [2026-06-16] Simulator template migrated to v2.x engine API

**Decision:** `templates/simulator.html` updated to use `E.stepFirst`/`E.stepSecond`, `E.VARS`, `E.band5`, `E.compile(state, schema, nowMs)` (number, not object), and inline schema normalization (applies_to default, "HH:MM" peak parsing). Built-in event names hardcoded as `BUILTIN_EVENT_NAMES` since `KICK_TABLE` is not exported from engine.js.

**Rationale:** The simulator template was calling stale v1.x engine API (`E.step`, `E.BUILTIN_EVENTS`, `E.band`, `SCHEMA.variables`) after the engine was rewritten for v2.x. The un-normalized schema also caused `effectiveBaseline` to crash on string peaks. This was a critical launch blocker — `animus simulate` failed immediately on load.

**Author:** claude/animus-handoff-review-eo9utx

---

## [2026-06-16] Remove unverified arXiv citation from engine.js and playground

**Decision:** Removed `Subaharan 2026, arXiv:2601.16087` from the engine.js header and the playground's clickable link. Retained the real references (ALMA: Gebhard 2005, WASABI: Becker-Asano 2008).

**Rationale:** The paper could not be verified as real. It was cited as "validating" the core second-order model in shipping code and as a clickable link in the public playground. A skeptical reader clicking a fabricated citation at launch would be severely damaging.

**Author:** claude/animus-handoff-review-eo9utx

---

## [2026-06-16] Adapter import names corrected to `@kahnark89/animus-*`

**Decision:** JSDoc `Usage:` examples in `packages/animus-{vercel-ai,langchain,mem0}/index.js` corrected from `@animus-sdk/*` to `@kahnark89/animus-*` to match the actual published package names.

**Rationale:** Copy-pasting the documented import from the JSDoc yielded `MODULE_NOT_FOUND`. For a drop-in adapter, the import line is the product.

**Author:** claude/animus-handoff-review-eo9utx
