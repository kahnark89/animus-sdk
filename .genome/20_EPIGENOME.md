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

**Decision:** `agent.memory.json` is plain JSON. The `.db` extension referenced in early drafts was rejected.

**Rationale:** Plain JSON is human-readable, debuggable without tooling, diffable in git, and trivially portable. No query capabilities are needed — the full state object is small (< 1KB for typical schemas).

**Author:** claude/cortex-animus-repos-eV8MC

---

## [2026-05-31] Atomic write pattern for Memory

**Decision:** `Memory.save()` writes to `<path>.tmp` then `fs.renameSync` to the final path.

**Rationale:** Prevents corrupt state files if the process is killed mid-write. `renameSync` is atomic on POSIX systems and near-atomic on Windows (same drive).

**Author:** claude/cortex-animus-repos-eV8MC

---

## [2026-05-31] Simulator: Canvas 2D, not React, no CDN

**Decision:** `simulator/simulator.js` uses plain Canvas 2D API. No React, no bundler, no CDN imports.

**Rationale:** The simulator must work as `file://` with no internet connection and no build step. CDN React breaks offline. The simulator is a diagnostic tool — it does not need production-grade UI framework.

**Author:** claude/cortex-animus-repos-eV8MC

---

## [2026-05-31] Simulator intentionally duplicates StateEngine logic

**Decision:** `simulator/simulator.js` re-implements the update equation inline rather than importing from `dist/`.

**Rationale:** The simulator has no build pipeline. `dist/` is CommonJS with `require()` — not importable as an ES module in a plain HTML `<script type="module">`. Duplication is the correct tradeoff here. The simulator is not a production code path.

**Author:** claude/cortex-animus-repos-eV8MC

---

## [2026-05-31] Test output to `.dist-test/` separate from production `dist/`

**Decision:** `tsconfig.test.json` compiles to `.dist-test/` instead of `dist/`. Production `tsconfig.json` excludes `src/__tests__/`.

**Rationale:** npm `"files": ["dist/"]` includes all of `dist/` regardless of `.npmignore` rules within it. Separating test output keeps the published package clean without complex glob exclusions.

**Author:** claude/cortex-animus-repos-eV8MC

---

## [2026-05-31] Circadian affects `energy` only

**Decision:** The circadian cosine modulation applies only to the `energy` variable's effective baseline, not all variables.

**Rationale:** Other variables (mood, curiosity, focus) feel the circadian rhythm indirectly via coupling from energy. Applying it directly to all variables would create unphysical correlations and reduce the schema's expressiveness.

**Author:** claude/cortex-animus-repos-eV8MC
