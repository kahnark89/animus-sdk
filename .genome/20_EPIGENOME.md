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

## [2026-06-17] Phrase corpus expanded to 2,000 (20 per band)

**Decision:** Each of the 100 phrase bands in `src/persona.js` (4 registers × 5 variables × 5 bands) was expanded from 8 phrases to 20 phrases, bringing the total from 800 to 2,000.

**Rationale:** 8 phrases per band caused noticeable repetition in long-running sessions. 20 phrases per band provides enough variety for the deterministic hash-based selection to feel non-repetitive across typical interaction lengths. The `packages/animus-persona` standalone package already targeted 20 phrases/band; `src/persona.js` is now consistent with that design intent.

**Author:** claude/phrase-count-genome-update-8lhfsj

---

## [2026-06-16] Adapter import names corrected to `@kahnark89/animus-*`

**Decision:** JSDoc `Usage:` examples in `packages/animus-{vercel-ai,langchain,mem0}/index.js` corrected from `@animus-sdk/*` to `@kahnark89/animus-*` to match the actual published package names.

**Rationale:** Copy-pasting the documented import from the JSDoc yielded `MODULE_NOT_FOUND`. For a drop-in adapter, the import line is the product.

**Author:** claude/animus-handoff-review-eo9utx

---

## [2026-06-17] Simulator fix from [2026-06-16] did NOT hold — re-fixed and now test-enforced

**Decision:** The [2026-06-16] "simulator migrated to v2.x engine API" entry was logged as complete but the result still crashed. The rewrite called `E.stepFirst(state, SCHEMA, nowMs, kicks, noiseState)` / `E.stepSecond(state, SCHEMA, nowMs, kicks, noiseState, velocity)` — argument order taken from `30_SELECTION.md §4`, which was itself **wrong**. Against the real engine (`stepFirst(state, noiseState, schema, nowMs, kicks)`) the schema landed in the wrong slot and the engine threw `Cannot destructure property 'magnitude' of 'schema.noise'` on the first `requestAnimationFrame`. Also `velocity = r.velocity` read a field the engine does not return (`velocityState`).

Corrected:
- `templates/simulator.html` step calls reordered to match `engine.js` exactly; `velocity = r.velocityState`.
- `30_SELECTION.md §4` contract table corrected for `stepFirst`, `stepSecond`, `runSteps`, `driftSetpoints`, `diagnose` (all five rows were wrong). Added a directive: if the contract table and the test disagree, the test wins.
- New suite `src/__tests__/simulator.test.js` (6 tests): builds the simulator exactly as `bin/animus.js` does, runs its real `<script>` headless in a `vm` + minimal DOM shim, drives ~25 animation frames on both the first-order (template) and second-order (generated persona) paths, and asserts it does not throw and emits a mood-line. Verified to FAIL on the pre-fix code (reproduces the exact crash) and PASS after. Wired into `npm test` and therefore CI.

**Rationale:** The recurring failure mode is that the genome recorded *intent* and CI only ran `npm test`, which never executed the generated artifact. A claim in the genome is now only as trustworthy as a test that fails when it is false. Test total: 87 → 93 across 5 suites.

**Author:** claude/animus-verification-review


---

## [2026-06-17] Five launch decisions implemented (v2.1.2)

**Decision:** Resolved the five open decisions from `10_PHENOTYPE.md §3`:

1. **`infer` default → kept `false`; README made honest.** Quickstart now passes `infer: true`
   explicitly with a tradeoff note (keyword-based, fires on quoted/discussed emotion words,
   multi-fires, English-only). Production stays predictable by default; the demo is alive.
2. **Adapters → demoted to `examples/adapters/`.** They are untested thin wrappers (no suite
   exercises them; the Vercel one may not match the current AI SDK streaming format). Shipping
   four unverified npm packages on day one was pure risk. `packages/` and the `workspaces` field
   removed. README never actually advertised `npm install @kahnark89/animus-*`, so only AGENTS.md
   structure changed.
3. **`AnimusTrigger.fire` → narrowed to `string`.** Runtime applies exactly one event type; the
   `string[]` form silently produced no kick. One-line `.d.ts` change removing a footgun.
4. **`packages/animus-persona` → deleted.** Verified it was a real fork: different phrase corpus
   ("scraped hollow" vs core's "storm-grey inside") AND different trait math (seed 42 →
   λ=0.158 standalone vs 0.1579 core), so the *same seed produced a different character*. Seeds
   are a character's identity; two generators break that. `src/persona.js` is now canonical.
5. **Version skew → resolved by bumping core to `2.1.2`** (package.json + `src/*.js` headers).
   Adapters are no longer packages, so nothing to sync. Schema-format `version: '2.0'` left as-is
   (it tracks the state-file format, not the package).

Plus a new guard for the deferred sixth item (three engine copies): **`engine-parity.test.js`**
feeds core / docs / playground an identical schema (noise off, no circadian) from an identical
displaced state and asserts their first-order trajectories agree to ~1e-16. Proven adversarial —
a 1% drift injected into the playground's homeostasis term fails it at step 16. Full consolidation
of the three engines is deferred; the parity test makes the duplication safe in the meantime.

Test total: 93 → 97 across 6 suites. All changes are backwards-compatible for the published
`animus-sdk` API (removed items were never in the npm `files` list).

**Author:** claude/animus-decisions-impl


---

## [2026-06-17] Engine consolidation — src/engine.js is the sole engine (v2.1.3)

**Decision:** Eliminated the duplicate engine implementations. There were three copies of the
physics (src/engine.js, docs/index.html, playground/index.html); now there is one.

- **Playground rewired to the production engine.** `playground/index.html` is no longer hand-authored
  with its own embedded engine. It is now built from `playground/playground.template.html` by
  `scripts/build-playground.js`, which inlines the **verbatim** `src/engine.js` + `src/persona.js`
  (the same pattern the CLI uses for the simulator). The template's UI is unchanged; a ~15-line shim
  maps the UI's call-shapes (`step`, `generatePersona`, `compileMoodLine`) onto the real API
  (`stepFirst`/`stepSecond`, `generatePersona`, `compile`). Net effect beyond DRY: the playground now
  shows the real register-based 2,000-phrase `compile()` output instead of its old flat
  `FALLBACK_PHRASES`, and a seed previewed in the playground is the exact character produced in Node.
- **docs/index.html toy deleted.** It embedded a stale v1-style engine (tiny 3-band vocab,
  multiplicative circadian) and was pure noise. `docs/` is now the generated GitHub Pages deploy copy
  of the playground (same build artifact), so the README's hosted-demo link serves the real engine.
- **`engine-parity.test.js` removed; `playground.test.js` added (8 tests).** Parity between copies is
  moot when there's one copy. The new suite asserts the template embeds no engine, the build inlines
  the exact production bytes, the built page runs headless on the real engine, it renders a real
  `compile()` mood-line, and the committed `playground/index.html` + `docs/index.html` are not stale.

**Rationale (user directive):** "src/engine.js the sole version; the simulator should draw from the
production version; the other embedded version omitted altogether as it is just noise clouding the
thinking space." Implemented exactly: one engine, both demos (simulator + playground) inline it,
toy deleted.

**Build/deploy note:** `npm run build:playground` regenerates `playground/index.html` and
`docs/index.html`; `prepublishOnly` runs the build then the tests. The playground test fails if the
committed build is stale. GitHub Pages should serve from `/docs` (or be pointed at the playground).

Test total: 97 → 101 across 6 suites (−4 parity, +8 playground).

**Author:** claude/animus-engine-consolidation

