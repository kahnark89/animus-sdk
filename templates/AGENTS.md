## Animus

This project uses [animus-sdk](https://github.com/kahnark89/animus-sdk) for persistent AI agent state.

**Key file:** `animus/agent.schema.json` — defines state variables, baselines, coupling, circadian rhythm, and mood-line compiler settings.

**Integration pattern:**
1. Before each LLM call: `const moodLine = agent.compile()` — append to the system prompt.
2. After each LLM call: `agent.apply(agent.parseEvents(reply))` — absorb `[[event:intensity]]` tags into the state engine.
3. Before display: `agent.cleanText(reply)` — strip the tags from what the user sees.
4. The LLM never receives raw state values — only the compiled mood-line paragraph.

**Do not:**
- Pass raw state variables to the LLM.
- Let LLM text modify state directly — only recognized event tags modify state; unknown tags are ignored by design.
- Modify `animus/agent.schema.json` from code at runtime. It is an architect-controlled definition.
