# AGENTS.md — animus-sdk

## What this repo is

A Node.js SDK that implements the **soul/mouth separation pattern** for AI agents: a physics-based affective state engine runs locally and persistently; the LLM receives exactly one compiled interface, the **mood-line paragraph**. The LLM never sees raw state values.

Current version: **2.1.0** — 87 tests passing, zero runtime dependencies.

---

## Genome files — read these first

The `.genome/` directory carries architectural memory across sessions. Read them before making non-trivial changes.

| File | Contents | Mutability |
|------|----------|------------|
| `.genome/00_GENOTYPE.md` | Core thesis, architecture invariants, hard lines | **Protected** — needs `GENOTYPE-CHANGE:` commit message + epigenome log entry |
| `.genome/10_PHENOTYPE.md` | Current version, acceptance criteria, open decisions, next actions | **Free to update** — high-churn |
| `.genome/20_EPIGENOME.md` | Append-only decision log | **Append-only** — never edit existing entries |
| `.genome/30_SELECTION.md` | Decision heuristics, autonomous action policy, engine API stability contract | **Protected** — needs architect sign-off |
| `.genome/40_SHADOW.md` | Ruled-out approaches and why | **Append-only** — never edit existing entries |

### Quick rules

- If you're fixing a bug or adding a feature: update `10_PHENOTYPE.md` (status + criteria) and append to `20_EPIGENOME.md` (decision log).
- If you're changing anything in `30_SELECTION.md §3 Review Triggers` list: stop and surface it for human review first.
- If you're ruling out an approach for a documented reason: append to `40_SHADOW.md`.
- If you're changing a GENOTYPE invariant: include `GENOTYPE-CHANGE: <reason>` in the commit message and log the change in `20_EPIGENOME.md`.

---

## Repo structure

```
src/
  engine.js       Pure physics — UMD, zero deps, runs in Node + browser + edge.
                  No I/O, no Date.now(), no fs. Exports: stepFirst, stepSecond,
                  runSteps, compile, eventsToKicks, parseEvents, inferEvents,
                  driftSetpoints, diagnose, band5, VARS, clamp01, DEFAULT_BANDS.
  index.js        Public Animus class — persistence, wall-clock ticking, episodic
                  memory, write-behind flush, CAS conflict handling.
  normalize.js    normalizeSchema (idempotent, deep-clone) + validateSchema.
  store.js        FileStore (atomic tmp-rename, CAS) + MemoryStore.
  persona.js      generatePersona(seed) — 4.3B distinct character DNAs.
  index.d.ts      Hand-maintained TypeScript declarations (no build step).
  __tests__/
    animus.test.js      42 core engine tests (original suite — never change these)
    readme.test.js      17 quickstart / schema / custom-event tests
    persistence.test.js 20 store + CAS + concurrency tests
    fidelity.test.js    8  Gaussian noise + anti-repetition + baseline idempotency

bin/
  animus.js       CLI: init, simulate, status

templates/
  agent.schema.json   Starter schema (used by `animus init`)
  example.js          Scaffolded quickstart (copied by `animus init`)
  simulator.html      Template for `animus simulate` — inlines engine.js + schema

packages/
  animus-langchain/   LangChain / LangGraph adapter (@kahnark89/animus-langchain)
  animus-vercel-ai/   Vercel AI SDK middleware (@kahnark89/animus-vercel-ai)
  animus-crewai/      CrewAI adapter (@kahnark89/animus-crewai)
  animus-mem0/        Mem0 memory bridge (@kahnark89/animus-mem0)
  animus-persona/     Standalone persona package (animus-persona)

examples/
  redis-store.js      Reference Redis/Postgres Store implementations

.github/
  workflows/ci.yml    npm test on Node 18/20/22, permissions: contents: read
```

---

## Core invariants (do not change without architect sign-off)

1. **Mood-line is the only interface.** The LLM never receives raw `{ mood: 0.73 }` values.
2. **`engine.js` is pure UMD.** No I/O, no `Date.now()`, no `fs` inside it. I/O belongs in `index.js`.
3. **Zero runtime dependencies.** No third-party `require()` in any file under `src/`, `bin/`, or `packages/*/`.
4. **CommonJS only.** No `"type": "module"` in `package.json`.
5. **`_applyBaselineShifts` recomputes from `_baseBaselines`.** Never accumulate shifts on top of already-shifted values.
6. **One process-global exit handler.** Never `process.on('exit', ...)` per `Animus` instance.
7. **Simulator works offline.** `templates/simulator.html` must run as `file://` with no CDN, no bundler.

---

## Key equations

**First-order (default):**
```
x(t+1) = clamp01(x(t) + λ·(x₀_eff − x(t)) + Σκ·(xj − xj*) + kick + ε)
```

**Second-order extension** (opt-in via `schema.second_order`):
```
v(t+1) = d·v(t) − ω²·(x(t) − x₀_eff) + kick
x(t+1) = clamp01(x(t) + v(t+1) + ε)
```

- λ (`homeostasis_rate`) ≈ 0.08 is the master pull-toward-baseline rate. Read from schema; never hard-code.
- κ (coupling) references effective (circadian-adjusted) setpoints, never raw baselines.
- ε is Gaussian noise: `magnitude` is a true σ (Box–Muller).

---

## Development conventions

- Plain CommonJS JavaScript + hand-maintained `index.d.ts` — **no build step, ever**.
- `npm test` runs all four suites directly with `node`. No test runner install needed.
- Engine API changes must be reflected in `templates/simulator.html` (it's the canonical browser consumer).
- When adding citations to `engine.js` or `playground/index.html`, verify the paper exists before committing.
- Adapter packages document imports as `@kahnark89/animus-*` — the `@animus-sdk/*` namespace is not published.
