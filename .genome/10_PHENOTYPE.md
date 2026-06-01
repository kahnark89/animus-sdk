# 10_PHENOTYPE — animus-sdk (live state)

> High-churn file. Any session updates this freely.
> **Last touched:** 2026-06-01 by claude/project-onboarding-9LqKa
> **Pending ratification:** none

---

## §1 Current focus

v0.1.0 is built and pushed to GitHub. Next step is npm publication and real-world validation.

---

## §2 Acceptance criteria

- [x] `StateEngine`, `Compiler`, `Memory`, `EventSystem`, `Animus` class implemented in `src/`
- [x] `src/adapters/cortex.ts` — `cortexToEvents` and `DEFAULT_MAPPING` exported
- [x] 41 tests passing (`npm test`)
- [x] `npm run build` produces clean `dist/` with no `__tests__/` leak
- [x] `simulator/index.html` + `simulator/simulator.js` — Canvas visualizer working
- [x] `bin/animus.js` — all commands: `init`, `status`, `simulate`, `inject --from-cortex`
- [x] GitHub Actions `release.yml` — triggers on `v*` tags
- [ ] `npm publish` — package live on npmjs.com as `animus-sdk`
- [ ] Smoke test: `npm install animus-sdk` in throwaway dir, `agent.compile()` returns mood-line

---

## §3 Open questions

- Should `agent.memory.json` include a format version field to ease future migrations?
- The `growth` object (`delightCount`, `sessionCount`) in MemoryFile is scaffolded but not yet incremented by any code path — decide whether to implement or remove in v0.2.
- Consider whether `parseFromText` should be called automatically after each LLM response or remain a manual call on the developer's side.

---

## §4 Next actions

1. Add `NPM_TOKEN` secret to GitHub repo settings
2. Set `main` as default branch in GitHub repo settings
3. `git tag v0.1.0 && git push origin v0.1.0` — triggers GitHub Actions publish
4. Verify: `npm view animus-sdk` — confirms publication
5. Smoke test from fresh directory
6. Update README npm badge once package is live

---

## §5 Deliverables on hand

- `src/` — full TypeScript implementation
- `dist/` — compiled CommonJS output
- `simulator/` — browser Canvas visualizer
- `examples/quickstart/` — minimal working TypeScript demo
- `templates/agent.schema.json` — starter schema
- `AGENTS.md` — AI session briefing
- `.github/workflows/release.yml` — automated npm publish on tag
