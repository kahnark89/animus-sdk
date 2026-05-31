## Animus

This project uses [animus-sdk](https://github.com/kahnark89/animus-sdk) for persistent AI agent state.

**Key file:** `animus/agent.schema.json` — defines state variables, baselines, coupling, circadian rhythm, and mood-line compiler settings.

**Integration pattern:**
1. Before each LLM call: `const moodLine = agent.compile()` — inject into system prompt
2. After each LLM call: `agent.apply(parseEvents(response))` — feed events back into state engine
3. The LLM never receives raw state variable values — only the compiled mood-line paragraph

**Do not:**
- Pass raw state variables to the LLM
- Let the LLM output modify state directly (only event tags modify state)
- Modify `animus/agent.schema.json` via code during runtime (it is an architect-controlled definition)
