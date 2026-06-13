**Title:**
Persistent mood physics for local LLM characters — zero cloud, works offline,
personality survives model swaps

**Body:**
Built this for a specific pain: AI characters that feel like the same vending
machine every session, regardless of how much you tune the system prompt.

The root cause: there's no internal state between calls. Prompting around it
doesn't persist correctly — the mood description resets every turn.

animus-sdk is a state engine that runs beside any local model:

- 5 coupled continuous variables in a JSON schema file you control
- Homeostasis, circadian rhythm, event kicks, autocorrelated noise
- Before each call: compiles to one paragraph you inject into the system prompt
- After each call: parses [[event:intensity]] tags back into the engine

Why it fits local setups:
- State updates need zero network calls — runs fully offline
- Personality lives in a JSON file on your machine, nothing in any vendor's cloud
- Swap Llama for Mistral for Qwen — the character's history comes with you
- Works with Ollama, LM Studio, or any OpenAI-compatible endpoint

The simulator runs the actual engine in the browser — no install:
https://kahnark89.github.io/animus-sdk

The circadian system reads the real clock. At 2:49 AM it compiled: "It's late
evening, a low-energy stretch of your day." That's not hardcoded, that's the
physics.

npm install animus-sdk
repo: github.com/kahnark89/animus-sdk
