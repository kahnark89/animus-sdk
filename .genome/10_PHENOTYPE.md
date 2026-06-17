# 10_PHENOTYPE — animus-sdk (live state)

> High-churn file. Any session updates this freely.
> **Last touched:** 2026-06-16 by claude/animus-handoff-review-eo9utx
> **Pending ratification:** none

---

## §1 Current version

**v2.1.0** — published to GitHub, npm publish pending.

---

## §2 Acceptance criteria

- [x] `Animus` class, `FileStore`, `MemoryStore`, `normalizeSchema`, `validateSchema`, `AnimusConflictError`, `defaultMemoryPath` all exported from `src/index.js`
- [x] `src/engine.js` — pure UMD; exports `stepFirst`, `stepSecond`, `runSteps`, `compile`, `eventsToKicks`, `parseEvents`, `inferEvents`, `driftSetpoints`, `diagnose`, `band5`, `VARS`, `clamp01`, `DEFAULT_BANDS`
- [x] `src/normalize.js` — `normalizeSchema` (idempotent, deep-clone), `validateSchema` (throws on bad schema, warns on dead triggers)
- [x] `src/store.js` — `FileStore` (atomic tmp-rename, corrupt-preserve, CAS), `MemoryStore` (in-process, CAS)
- [x] `src/persona.js` — `generatePersona(seed)` — 4.3 billion distinct character DNAs
- [x] 87 tests passing across 4 suites: `animus.test.js` (42) + `readme.test.js` (17) + `persistence.test.js` (20) + `fidelity.test.js` (8)
- [x] `bin/animus.js` — `init`, `simulate`, `status`; `simulate` generates a working `animus/simulator.html`
- [x] `templates/simulator.html` — uses `E.stepFirst`/`E.stepSecond`, `E.band5`, `E.compile(state,schema,nowMs)`, inline schema normalization; no stale API calls
- [x] `templates/agent.schema.json` — correct event names, stable `id`, `absence` trigger (not dead `long_absence`)
- [x] `templates/example.js` — scaffolded quickstart for `animus init`
- [x] `src/index.d.ts` — `Animus`, `AnimusConflictError`, `AnimusStore`, `FileStore`, `MemoryStore`, `open`, `flush`, `flushSync`, `close`, `couple`, `decouple` all declared
- [x] `.github/workflows/ci.yml` — runs `npm test` on Node 18/20/22, `permissions: contents: read`
- [x] Adapter packages under `packages/` — import examples use `@kahnark89/animus-*` (not the stale `@animus-sdk/*`)
- [x] `_applyBaselineShifts()` idempotency fix — shifts recomputed from `_baseBaselines`, not accumulated
- [ ] `npm publish` — package live on npmjs.com as `animus-sdk`
- [ ] `npm publish --workspaces --access public` for adapter packages (decision required — see §3)

---

## §3 Open decisions

- **Adapter packages publishing:** `packages/*` are not wired into the release workflow. `release.yml` publishes only the root `animus-sdk`. Decide before launch: (a) wire `npm publish --workspaces --access public` into release, or (b) document them as "reference implementations, install manually". The README currently sells adapters as `npm install @kahnark89/animus-langchain` which implies (a).
- **`infer` default:** Currently `false` — `apply(llmText)` is a silent no-op without `[[event]]` tags unless `infer:true`. Consider flipping to `true` for zero-config UX, or making the README quickstart explicit about enabling inference.
- **`AnimusTrigger.fire` typing:** Declared as `string | string[]` in `.d.ts` but runtime only handles `string`. Either broaden the runtime or narrow the type.
- **`packages/animus-persona`:** Unscoped (`animus-persona`) while the rest are `@kahnark89/*`. The `src/persona.js` (core, 394 lines) and `packages/animus-persona/src/persona.js` (standalone, 1,367 lines) are two parallel implementations. Decide which is canonical; have one import the other or document the split.
- **Version skew:** `packages/*` still at `2.0.0`; core at `2.1.0`. Harmless given `^2.0.0` peer ranges but reads as unsynced.

---

## §4 Next actions

1. Decide adapter publishing strategy (§3 above) and either wire release workflow or update README
2. Add `NPM_TOKEN` secret to GitHub repo settings
3. `git tag v2.1.0 && git push origin v2.1.0` — triggers `release.yml`
4. Verify: `npm view animus-sdk` confirms v2.1.0
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
