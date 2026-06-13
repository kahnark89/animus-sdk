**Title:**
NPCs that carry emotional state across sessions — a 5-variable affect engine
with a game-event API

**Body:**
Sharing something I built that might be useful for procedural NPC personality.

The problem: NPC emotional arcs that persist across play sessions without
scripting every case. A guard still wary two sessions later because of what
happened at the gate. A merchant warmer now because you brought her news.

animus-sdk is a small dynamical-systems engine:

- 5 coupled continuous variables: mood, energy, curiosity, affection, focus
- Homeostasis toward baseline + cross-variable coupling + event kicks + circadian
  rhythm + bounded noise
- Before each LLM call: compiles state to a natural-language paragraph
- After each LLM call: parses [[event:intensity]] tags back into the engine
- Persists across sessions in a JSON file — the NPC wakes up where it left off

Game events map directly to the kick system:

```json
"events": {
  "player_helped":   { "affection": 0.20, "mood": 0.10 },
  "player_attacked": { "mood": -0.30, "affection": -0.25 },
  "trade_completed": { "mood": 0.10, "energy": 0.05 },
  "long_absence":    { "affection": -0.08, "mood": -0.05 }
}
```

Coupling means effects compound — sustained low energy drags mood, which drags
focus, which changes how the NPC engages.

Live simulator (actual shipping engine): https://kahnark89.github.io/animus-sdk

npm install animus-sdk
repo: github.com/kahnark89/animus-sdk

One thing I haven't solved: fitting coupling coefficients from actual player
interaction data vs hand-tuning. If anyone's done something similar I'd be
curious how you approached it.
