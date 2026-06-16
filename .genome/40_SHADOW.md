# 40_SHADOW — animus-sdk

> **Append-only.** Never edit or delete existing entries.
> Each entry: ID, what was tried, why it was ruled out, date.

---

## S001 — React + bundler for simulator

**Tried:** Using React (via CDN or bundler) for the simulator UI.

**Ruled out:** CDN React breaks offline constraint — the simulator must work as `file://` with no internet. A bundler requires a build pipeline, which adds complexity and breaks the "zero build step" requirement for the simulator. Canvas 2D gives equivalent visualization with zero dependencies.

**Date:** 2026-05-31

---

## S002 — Binary / SQLite for state file

**Tried:** Using a `.db` extension (suggesting SQLite or binary format) for the agent state file.

**Ruled out:** Binary formats are not human-readable, not diffable in git, and require native bindings which break the zero-dependency constraint. Plain compact JSON is sufficient — the full state object is < 2KB for typical schemas.

**Date:** 2026-05-31

---

## S003 — `"type": "module"` in package.json

**Tried:** Adding `"type": "module"` to enable ES module syntax in bin files.

**Ruled out:** The CLI (`bin/animus.js`) uses `require()` throughout. ESM interop in the CommonJS→ESM direction is non-trivial and the zero-dep constraint means no bundler to smooth it over.

**Date:** 2026-05-31

---

## S004 — Injecting raw state values into LLM prompts

**Tried:** Passing `{ mood: 0.73, energy: 0.61, ... }` directly into the system prompt alongside the mood-line.

**Ruled out:** Raw numeric state defeats the purpose of compilation. It invites the LLM to reason about the numbers directly, creating a feedback loop where the LLM's awareness of its own "scores" affects its output in unpredictable ways. The mood-line is the boundary — all state communication crosses it as language, not data.

**Date:** 2026-05-31

---

## S005 — Multiple output channels from `compile()`

**Tried:** Adding a second compiled output (e.g., a "focus summary" separate from the mood-line) to inject alongside it.

**Ruled out:** The single-string interface is a feature. Multiple output channels create coupling between the SDK and the prompt structure of each integrator. The mood-line is designed to be self-contained.

**Date:** 2026-05-31

---

## S006 — Calling stale engine API in the simulator template

**Tried:** `E.step(state, schema, {date, kicks, noiseState})`, `E.BUILTIN_EVENTS`, `E.band()`, `SCHEMA.variables` in `templates/simulator.html`.

**Ruled out / fixed:** These were v1.x engine API calls that no longer existed after the v2.x rewrite. The template was not migrated with the engine, causing `animus simulate` to crash immediately on the first `requestAnimationFrame`. Fixed in `[2026-06-16]` commit: use `E.stepFirst`/`E.stepSecond`, `E.VARS`, `E.band5`, `E.compile(state, schema, nowMs)`. Inline schema normalization added to handle raw user schemas without requiring normalize.js in the browser bundle.

**Date:** 2026-06-16

---

## S007 — Per-instance process.on('exit') handlers

**Tried:** Installing one `process.on('exit', flush)` listener per `Animus` instance on construction.

**Ruled out:** A server holding thousands of per-user `Animus` instances would immediately trip `MaxListenersExceededWarning` (Node.js default limit: 10). Instead: one process-global pair of `exit`/`beforeExit` listeners (installed once, idempotent) iterates a module-level dirty-instance registry. Instances are held in the registry only while dirty and drop out the moment they flush, so they still garbage-collect normally.

**Date:** 2026-06-16

---

## S008 — Accumulating baseline shifts in place

**Tried:** `_applyBaselineShifts()` reading from `this.schema.baselines[v]` (already shifted) and adding `delta` again on each call.

**Ruled out / fixed:** Each call re-accumulated the shift on top of the already-shifted value, so a long-lived instance with any drift or growth-rule fired would see baselines walk toward 0/1 over a session. Stored state in `db.baselineShifts` stayed correctly bounded; the damage was in-memory only and self-healed on a fresh load. Fixed: capture pristine baselines in `this._baseBaselines` at construction; `_applyBaselineShifts` always recomputes from `base + shift`.

**Date:** 2026-06-16

---

## S009 — Unverified arXiv citation in shipping code

**Tried:** `Subaharan 2026, arXiv:2601.16087` cited in engine.js header and linked from `playground/index.html` as validating the second-order model.

**Ruled out:** The paper could not be verified as real. A fabricated citation in shipping code and a public playground link is a credibility-ending finding at launch. Removed; real analogous references (ALMA: Gebhard 2005, WASABI: Becker-Asano 2008) retained. Policy: any citation added to engine.js or playground must be verified before merge (see `30_SELECTION.md §3`).

**Date:** 2026-06-16
