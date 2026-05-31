# 40_SHADOW — animus-sdk

> **Append-only.** Never edit or delete existing entries.
> Each entry: ID, what was tried, why it was ruled out, date.

---

## S001 — React + bundler for simulator

**Tried:** Using React (via CDN or bundler) for the simulator UI.

**Ruled out:** CDN React breaks offline constraint — the simulator must work as `file://` with no internet. A bundler requires a build pipeline, which adds complexity and breaks the "zero build step" requirement for the simulator. Canvas 2D gives equivalent visualization with zero dependencies.

**Date:** 2026-05-31

---

## S002 — Binary / SQLite for memory file

**Tried:** Using a `.db` extension (suggesting SQLite or binary format) for the agent memory file.

**Ruled out:** Binary formats are not human-readable, not diffable in git, and require native bindings (sqlite3, better-sqlite3) which would break the zero-dependency constraint. Plain JSON is sufficient — the full state object is < 1KB for typical schemas.

**Date:** 2026-05-31

---

## S003 — `"type": "module"` in package.json

**Tried:** Adding `"type": "module"` to enable ES module syntax in bin files.

**Ruled out:** The CLI (`bin/animus.js`) uses `require()` throughout and loads `dist/` CommonJS modules. Adding `"type": "module"` would break all `require()` calls. ESM interop in Node.js CommonJS→ESM direction is non-trivial. The zero-dep constraint also means no bundler to smooth this over.

**Date:** 2026-05-31

---

## S004 — Injecting raw state values into LLM prompts

**Tried:** Passing `{ mood: 0.73, energy: 0.61, ... }` directly into the system prompt alongside the mood-line.

**Ruled out:** Raw numeric state defeats the purpose of compilation. It invites the LLM to reason about the numbers directly, creating a feedback loop where the LLM's awareness of its own "scores" affects its output in unpredictable ways. The mood-line is the boundary — all state communication crosses it as language, not as data.

**Date:** 2026-05-31

---

## S005 — Multiple output channels from `compile()`

**Tried:** Adding a second compiled output (e.g., a "focus summary" separate from the mood-line) to inject alongside the mood-line.

**Ruled out:** The single-string interface is a feature. Multiple output channels create coupling between the SDK and the prompt structure of each integrator. The mood-line is designed to be self-contained — if more context is needed, it goes in the mood-line, not in a parallel channel.

**Date:** 2026-05-31
