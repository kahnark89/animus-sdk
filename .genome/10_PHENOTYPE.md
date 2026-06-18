# 10_PHENOTYPE — animus-sdk (live state)

> High-churn file. Any session updates this freely.
> **Last touched:** 2026-06-17 by claude/animus-engine-consolidation
> **Pending ratification:** none

---

## §1 Current version

**v2.1.3** — GitHub only, npm publish pending. (2.1.0–2.1.2 were pre-release dev
checkpoints; first npm publish will be 2.1.3.)

---

## §2 Acceptance criteria

- [x] `Animus` class, `FileStore`, `MemoryStore`, `normalizeSchema`, `validateSchema`, `AnimusConflictError`, `defaultMemoryPath` all exported from `src/index.js`
- [x] `src/engine.js` — pure UMD; exports `stepFirst`, `stepSecond`, `runSteps`, `compile`, `eventsToKicks`, `parseEvents`, `inferEvents`, `driftSetpoints`, `diagnose`, `band5`, `VARS`, `clamp01`, `DEFAULT_BANDS`
- [x] `src/normalize.js` — `normalizeSchema` (idempotent, deep-clone), `validateSchema` (throws on bad schema, warns on dead triggers)
- [x] `src/store.js` — `FileStore` (atomic tmp-rename, corrupt-preserve, CAS), `MemoryStore` (in-process, CAS)
- [x] `src/persona.js` — `generatePersona(seed)` — 4.3 billion distinct character DNAs
- [x] 101 tests passing across 6 suites: `animus.test.js` (42) + `readme.test.js` (17) + `persistence.test.js` (20) + `fidelity.test.js` (8) + `simulator.test.js` (6) + `playground.test.js` (8)
- [x] `bin/animus.js` — `init`, `simulate`, `status`; `simulate` generates a working `animus/simulator.html` (now enforced by `simulator.test.js`, which runs the generated artifact headless)
- [x] `templates/simulator.html` — calls `E.stepFirst`/`E.stepSecond` with the **correct engine argument order** (was reversed in the 06-16 attempt and crashed); `E.band5`, `E.compile(state,schema,nowMs)`, inline normalization; no stale API calls
- [x] `templates/agent.schema.json` — correct event names, stable `id`, `absence` trigger (not dead `long_absence`)
- [x] `templates/example.js` — scaffolded quickstart for `animus init`
- [x] `src/index.d.ts` — `Animus`, `AnimusConflictError`, `AnimusStore`, `FileStore`, `MemoryStore`, `open`, `flush`, `flushSync`, `close`, `couple`, `decouple` all declared; `AnimusTrigger.fire` narrowed to `string` to match runtime
- [x] `.github/workflows/ci.yml` — runs `npm test` on Node 18/20/22, `permissions: contents: read`
- [x] Framework adapters relocated to `examples/adapters/` (reference implementations, not published packages); `packages/` and the `workspaces` field removed
- [x] **Single engine.** `src/engine.js` is the only engine implementation. The playground is built from `playground/playground.template.html` by `scripts/build-playground.js`, which inlines the verbatim `engine.js` + `persona.js`; the old `docs/index.html` toy engine was deleted. `playground.test.js` asserts the built page runs the exact production bytes and renders a real `compile()` mood-line.
- [x] `_applyBaselineShifts()` idempotency fix — shifts recomputed from `_baseBaselines`, not accumulated
- [x] `scripts/verify.js` (`npm run verify`) — 5-gate independent verifier (unit, physics sweep, headless artifact, genome-claim audit, regression hygiene)
- [ ] `npm publish` — package live on npmjs.com as `animus-sdk`

---

## §3 Open decisions

_Resolved 2026-06-17 (see EPIGENOME [2026-06-17] "five launch decisions"):_

- ~~**Adapter packages publishing**~~ → **RESOLVED:** demoted to `examples/adapters/` as
  reference implementations (not published). README never actually sold `npm install
  @kahnark89/animus-*`, so no doc change needed beyond AGENTS.md structure. `packages/` and
  `workspaces` removed.
- ~~**`infer` default**~~ → **RESOLVED:** kept `false` for production predictability; README
  quickstart now sets `infer: true` explicitly with a documented tradeoff note (keyword-based,
  context-blind, English-only). Default unchanged — code is safe-by-default, demo is alive.
- ~~**`AnimusTrigger.fire` typing**~~ → **RESOLVED:** narrowed `.d.ts` to `string` (runtime only
  ever applies one event type; the array form silently produced no kick).
- ~~**`packages/animus-persona`**~~ → **RESOLVED:** deleted. It was a true fork — different phrase
  corpus AND different trait math, so the same seed produced a *different character* than core.
  `src/persona.js` is now the single seed→character source. (Standalone's alternate phrases are
  in git history if ever wanted.)
- ~~**Version skew**~~ → **RESOLVED:** adapters are no longer packages, so nothing to sync. Core
  bumped to `2.1.2` across `package.json` and the `src/*.js` headers (schema-format `version: '2.0'`
  is intentionally separate from package version).

_Still open (genuine choices, not bugs):_

- ~~**Three engine implementations**~~ → **RESOLVED 2026-06-17.** `src/engine.js` is now the sole
  engine. The playground was rewired to inline the verbatim production engine/persona at build time
  (template + `scripts/build-playground.js`); the `docs/index.html` toy was deleted and `docs/` is
  now the generated GitHub Pages deploy copy of the playground. `playground.test.js` enforces this.
  Nothing remains on this front.

---

## §4 Next actions

1. `npm run verify` green (gates: unit, physics, artifact, claim audit, hygiene)
2. Add `NPM_TOKEN` secret to GitHub repo settings
3. `git tag v2.1.3 && git push origin v2.1.3` — triggers `release.yml`
4. Verify: `npm view animus-sdk` confirms v2.1.3
5. Smoke test: `npm install animus-sdk` in throwaway dir; `animus init && node animus/example.js && animus status`

---

## §5 Phrase corpus size

The corpus is **2,000 phrases** (4 registers × 5 variables × 5 bands × 20 phrases each) in `src/persona.js`.

---

## §6 Test count history

| Version | Tests |
|---------|-------|
| v0.1.0  | 28    |
| v2.0.0  | 42    |
| v2.1.0  | 87    |
| v2.1.1  | 93    |
| v2.1.2  | 97    |
| v2.1.3  | 101   |
