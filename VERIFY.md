# VERIFY — how to legitimately verify animus-sdk

This repo has a self-describing governance layer (`.genome/`). That layer is useful
but it is **documentation**, and documentation can assert fixes that don't hold —
it happened twice with the simulator. So do not trust checkmarks. Verify by
**executing the code** and by **auditing every claimed number against reality.**

## One command

```bash
npm run verify
```

`scripts/verify.js` runs five independent gates and exits non-zero if any fail:

| Gate | What it actually does | Catches |
|------|----------------------|---------|
| 1 · UNIT | Runs the full `npm test` (5 suites, incl. the headless simulator) | Logic/persistence/physics/compiler regressions |
| 2 · PHYSICS | Sweeps 2,000 seeds × 2,000 steps from scratch | NaN, velocity divergence, 0/1 saturation; re-checks the `k_me·k_em < λ²` stability guarantee on every coupled seed |
| 3 · ARTIFACT | Builds `simulator.html` the way the CLI does and runs its real `<script>` in a headless DOM, both first- and second-order paths | The simulator calling the engine with the wrong API/arg-order (the bug that shipped twice) |
| 4 · CLAIMS | Audits the genome's **numbers** against the code | A `10_PHENOTYPE.md` phrase-count or test-count that doesn't match reality |
| 5 · HYGIENE | Greps for the specific regressions already hit | Stale `E.step`/`E.BUILTIN_EVENTS` in the simulator, the removed `arXiv:2601.16087` citation, `@animus-sdk/*` import examples in adapters |

Both the simulator test and the claim-audit gate are **proven adversarial**: they
have been run against deliberately-broken code and confirmed to go red. A gate that
can't fail proves nothing.

## The four rules this enforces

1. **Run the artifact, don't read it.** `animus simulate` ships a generated HTML
   file. The only honest test executes that exact file. `src/__tests__/simulator.test.js`
   inlines the real engine + schema (same as `bin/animus.js`), runs the page script
   in `vm` + a minimal DOM shim, and drives the animation loop.
2. **Every claim maps to a test that fails when the claim is false.** "2,000 phrases"
   and "93 tests" are checked against the code each run (gate 4). If you change one,
   the other must change or `verify` fails.
3. **Ground truth is `src/engine.js`, not a contract doc.** `.genome/30_SELECTION.md §4`
   documents the engine signatures; if it and the test ever disagree, the test wins.
   That doc was the *cause* of the last regression, not a defense against it.
4. **Prove the test is red before you trust it green.** To convince yourself a check
   works, break the thing it guards, run the check, see it fail, then restore. Example:
   reverse the `stepFirst` args in `simulator.html` → `npm run test:simulator` fails
   with `Cannot destructure property 'magnitude' of 'schema.noise'`.

## Manual spot-checks (independent of the genome)

```bash
# Engine signatures are the ground truth — read them directly:
grep -nE 'function (stepFirst|stepSecond|runSteps|compile|diagnose)\(' src/engine.js

# Phrase corpus size, computed from code (not from any doc):
node -e "const{VOICE_REGISTERS:V}=require('./src/persona');let n=0;for(const r in V)for(const v in V[r])for(const b in V[r][v])n+=V[r][v][b].length;console.log(n)"

# The real CLI output runs (not a reconstruction):
mkdir -p /tmp/animus-check && cp -r templates /tmp/animus-check/ && cd /tmp/animus-check \
  && node "$OLDPWD/bin/animus.js" init && node "$OLDPWD/bin/animus.js" simulate \
  && echo "open animus/simulator.html in a browser to watch it live"
```

## Before publishing

`npm run verify` green is necessary, not sufficient. It does not cover the items the
genome lists as **open decisions** (these are choices, not bugs):

- `infer` defaults to `false` — `apply(llmText)` is a no-op without `[[event]]` tags
  unless you pass `{ infer: true }`.
- Adapter packages (`packages/*`) are at `2.0.0` while core is `2.1.0`, and are not
  wired into the release workflow — decide publish-vs-document before launch.
- `AnimusTrigger.fire` is typed `string | string[]` but the runtime only handles `string`.

These are tracked in `.genome/10_PHENOTYPE.md §3`. Resolve or consciously accept them.
