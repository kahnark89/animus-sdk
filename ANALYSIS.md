# animus-sdk: Technical Analysis
**Capps Consulting Company LLC — June 2026**

---

## What It Is

`animus-sdk` is a **persistent affective state engine for AI characters**. It is the computational layer that sits between a language model and the application layer, maintaining a continuous, physics-driven emotional state for an NPC, companion AI, or virtual character across unlimited time and interactions.

The core problem it solves: without this layer, every LLM response is stateless. The model has no inherent memory of whether it has been talking to someone for five minutes or five months, no way to feel the passage of time, no way to grow or change from accumulated experience. `animus-sdk` solves this by maintaining a live state vector — numerical variables representing mood, energy, curiosity, affection, focus — that evolves continuously according to dynamical systems equations, responds to events, remembers what has happened, and compiles all of this into a single paragraph that is injected into the LLM's system prompt on every call.

The LLM never sees the numbers. It sees prose: *"You're genuinely curious; a little low on energy. Lifting. It's midday, one of your more engaged times. You've been thinking about the auth system and the deployment incident lately."* That single sentence is everything the model needs to produce consistent, emotionally continuous responses.

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│                        Host Application                          │
│  (game, chatbot, companion app, agent framework)                 │
└────────────┬────────────────────────────────┬───────────────────┘
             │ apply(events)                  │ compile()
             │ gist(topics)                   │  → paragraph for LLM
             ▼                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        src/index.js                              │
│  Animus class — persistence, memory, triggers, growth, trends    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  JSON db     │  │  topicFreq   │  │  eventLog              │ │
│  │  (state,     │  │  (gist)      │  │  (trigger/growth       │ │
│  │  noiseState, │  │              │  │   condition source)    │ │
│  │  memories)   │  │              │  │                        │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │ pure math calls
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                        src/engine.js                             │
│  Pure functions — step(), compile(), eventsToKicks(), etc.       │
│  UMD: runs identically in Node and browser                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              packages/animus-persona/src/persona.js              │
│  Standalone DNA generator — seed → complete schema               │
│  Also bundled in src/persona.js for integrated use               │
└─────────────────────────────────────────────────────────────────┘
```

---

## The State Engine (engine.js)

### The Update Equation

Every step, each state variable is updated according to:

```
x(t+1) = clamp₀₁(
    x(t)
  + λ · (x₀_eff(t) − x(t))     ← homeostasis
  + Σⱼ κⱼₓ · (xⱼ(t) − x₀ⱼ_eff)  ← coupling
  + kick_x                       ← event
  + εₓ(t)                        ← noise
)
```

**Homeostasis** (`λ · (x₀_eff − x)`): Every variable is pulled toward its effective baseline at rate λ (the homeostasis rate, typically 0.03–0.18). This means emotional states are not permanent — they return toward equilibrium. A character who is delighted will gradually calm back to their normal mood over time.

**Effective baselines** (`x₀_eff`): The baseline is not fixed. For variables in `circadian.applies_to` (energy by default), the baseline oscillates according to a circadian rhythm — a sum of Gaussians centered on peaks (e.g., 09:00 and 14:00), with a floor. A character genuinely has more energy at their peak times and less at 3am. The effective baseline is what homeostasis pulls toward at any given moment in real time.

**Coupling** (`Σ κⱼₓ · (xⱼ − x₀ⱼ_eff)`): Variables can influence each other. The typical configuration is `energy → {mood, curiosity, focus}`: when energy is above its effective baseline, it provides a positive coupling term to mood, curiosity, and focus. A character who is energized naturally becomes more curious and focused. This coupling uses deviations from effective baselines, not raw values, which ensures the system remains stable and doesn't saturate.

**Stability guarantee**: For any coupling loop (e.g., energy→mood and mood→energy), the system is stable if and only if `k₁ × k₂ < λ²`. The persona generator enforces this by hard-capping `k_mood→energy ≤ min(0.04, λ²/k_energy→mood × 0.90)`.

**Noise** (`εₓ(t)`): Autocorrelated Ornstein-Uhlenbeck noise. Each step: `εₓ(t) = ρ · εₓ(t−1) + σ · N(0,1)`, clamped to `±3σ`. This makes the character feel alive even with no user interaction — moods drift in realistic correlated arcs rather than random jitter. A character having a bad morning stays bad for a while before recovering.

**Kicks**: Events apply one-time delta kicks to variables. A `delight` event applies `{mood: +0.20, energy: +0.10}`. A `fatigue` event applies `{energy: −0.25}`. All values are clamped to [0, 1] after every step — the state space is always bounded and physically coherent.

### Circadian Rhythm

```
factor(t) = floor + (1 − floor) × max_i( exp(−d²ᵢ / 2σ²) )
```

where `dᵢ` is the angular distance (in minutes, wrapping at midnight) from the current time to peak `i`. This creates a realistic daily energy envelope: high near the peaks, approaching the floor in the dead of night. The `floor` parameter prevents energy from hitting zero even at 3am.

### The Compiler

The compiler translates the state vector into a natural-language paragraph. Key properties:

**Deviation-based selection**: Instead of always mentioning all variables, it scores each one by its absolute deviation from its effective baseline. Variables that are notably off (|dev| ≥ 0.08) are mentioned. If nothing is notable, the most deviated variable is mentioned anyway — the character always has something to express. Maximum 3 variables are mentioned, most deviated first.

**5-band vocabulary**: Each variable has phrases for `very_low`, `low`, `mid`, `high`, `very_high` bands, with thresholds at [0.15, 0.35, 0.65, 0.85]. Phrase selection within a band is deterministic, based on a hash of the state vector — this means the same state always produces the same phrase, tests are stable, and there is no external randomness dependency.

**Trend detection**: The compiler compares the current state to the previous compile's snapshot. If the lead variable has shifted by more than 0.03 in either direction, a trend clause is appended: `"Lifting."` or `"Still sliding."` This lets the LLM know whether the emotional arc is improving or deteriorating.

**Time context**: The time of day is rendered as human language (`"It's midday, one of your more engaged times."` vs. `"It's the middle of the night, a low-energy stretch."`), tied to the actual circadian factor at that moment.

**Memory injection**: If topics have been tracked via `gist()`, the top 3 surface in the mood-line: `"You've been thinking about auth, billing, and the deployment incident lately."` This provides conversational continuity across sessions.

---

## The Animus Class (index.js)

The `Animus` class wraps the pure engine with persistence, wall-clock time, memory, triggers, and growth. It is the public API.

### Persistence

State is stored in a JSON file (the "memory path"). On every mutating operation (`apply`, `tick`, `remember`, `gist`), the db is written atomically: write to `.tmp` then rename. The db structure:

```json
{
  "state":          { "mood": 0.71, "energy": 0.58, ... },
  "noiseState":     { "mood": -0.012, ... },
  "lastTick":       1781179260000,
  "memories":       [{ "text": "the auth incident", "salience": 0.9, "t": 1781100000000 }],
  "eventLog":       [{ "t": 1781179200000, "type": "delight", "i": 1 }],
  "topicFreq":      { "auth": { "count": 7, "lastSeen": 1781179260000 } },
  "triggerState":   { "0": { "lastFiredAt": 1781179260000 } },
  "growthApplied":  { "0": true },
  "baselineShifts": { "mood": 0.05 }
}
```

On load, `_applyBaselineShifts()` re-applies any persisted growth shifts to the in-memory schema baselines. This means a character whose mood baseline grew by 0.05 over hundreds of interactions will still have that elevated baseline after a process restart.

### Wall-Clock Time

`tick()` computes how many simulation steps have elapsed since `lastTick`:

```js
steps = Math.floor((now - lastTick) / stepMs)
steps = Math.min(steps, 240)  // cap: 4 hours at 1 step/minute
```

The cap prevents a character who hasn't been used in two weeks from running 20,000 steps at once. When they come back after a long absence, at most 240 steps run — enough to let the state drift meaningfully toward equilibrium, but not to fully converge. This means a character will feel different after a week away, but not fully reset.

### The Trigger System

`schema.triggers` is an array of auto-fire rules. After every `tick()`, all triggers are evaluated:

```json
{ "condition": "elapsed_days > 1.2", "fire": "long_absence", "cooldown_steps": 1440 }
{ "condition": "energy < 0.23", "fire": "fatigue", "cooldown_steps": 72 }
```

Supported condition forms:
- `elapsed_days > N` — time since last tick
- `elapsed_hours > N` — same, in hours
- `{variable} < N` — state threshold (e.g., energy too low)
- `{variable} > N` — state threshold (e.g., mood spike)
- `{event}_count > N` — total event history count

The cooldown prevents triggers from firing too frequently. A `long_absence` trigger with `cooldown_steps: 1440` fires at most once per day. This creates the experience of a character who notices when you've been gone, but only responds once per absence, not on every tick.

### The Growth System

`schema.growth.rules` are one-shot permanent baseline shifts. Each rule has a trigger condition and a shifts map:

```json
{
  "trigger": "delight_count > 67",
  "shifts": { "mood": 0.025, "affection": 0.011 }
}
```

When the condition is met, the shift is applied to `schema.baselines` and recorded in `db.growthApplied` and `db.baselineShifts`. It never fires again. This is how a character can genuinely change over time — not just in memory or tone, but in their physics. A character who has received many delights will have a measurably higher mood baseline, meaning their set point is permanently elevated. A character who has experienced many fatigue events will have a permanently lower energy baseline.

### The Memory System

Two parallel memory tracks:

**Episodic memory** (`remember(text, salience)`): Free-text beats stored with a salience score and timestamp. Salience decays with a 7-day halflife: `weight = salience × 0.5^(ageDays/7)`. Old memories fade unless they are rehearsed (called again). Capped at 200 beats.

**Topic frequency** (`gist(topics)`): Lightweight topic logging designed to be called after every LLM exchange. Accepts a comma-separated string or array. Tracks count × recency: `score = count × 0.5^(ageDays/7)`. Capped at 500 distinct topics, pruned by score when full.

Both tracks feed into `topMemories(n)`, which returns the top N items by score from the combined pool. `compile()` automatically injects the top 3 into the mood-line paragraph.

---

## The Persona DNA System (persona.js)

### Purpose

The persona system solves a fundamental problem: without it, all NPCs share the same physics. Two characters diverge only because of noise — they are the same kind of being with different histories. The persona system makes the physics itself per-NPC. A 32-bit integer seed deterministically generates a completely different emotional organism.

### The PRNG: mulberry32

A seeded pseudo-random number generator by Tommy Ettinger. It is a bijection on 32-bit integers — each seed produces a unique, non-repeating sequence of floats in [0, 1). Zero dependencies, works in any JavaScript environment. The draw order is a versioned protocol (v1) that must never change:

```
[valence, arousal, stability, sociability, drive, voice_pick]
```

Reordering this list silently reassigns all existing seeds to different personas, breaking saved characters.

### The 5 Trait Dimensions

| Trait | Controls |
|-------|----------|
| **valence** | Emotional set point — negative (0) to positive (1) |
| **arousal** | Energy level and reactivity |
| **stability** | Emotional inertia and resilience |
| **sociability** | Warmth and social responsiveness |
| **drive** | Focus and persistence |

Each trait is a float in [0, 1) drawn from the seed.

### Parameter Mappings

All use `lerp(min, max, trait)` — every parameter is bounded to a real-world-plausible range:

| Parameter | Range | Trait |
|-----------|-------|-------|
| `baselines.mood` | [0.35, 0.80] | valence |
| `baselines.energy` | [0.35, 0.85] | arousal |
| `baselines.affection` | [0.25, 0.80] | avg(valence, sociability) |
| `baselines.focus` | [0.35, 0.80] | drive |
| `baselines.curiosity` | [0.40, 0.85] | avg(drive, valence) |
| `homeostasis_rate λ` | [0.03, 0.18] | stability (stable → faster recovery) |
| `noise.magnitude` | [0.008, 0.045] | 1 − stability |
| `noise.autocorrelation` | [0.40, 0.88] | 1 − stability |
| Morning peak hour | [6, 10] | arousal |
| Afternoon peak hour | [13, 16] | sociability |
| `circadian.floor` | [0.05, 0.40] | arousal |
| `event_sensitivity.delight` | [0.60, 1.50] | valence |
| `event_sensitivity.reunion` | [0.50, 1.80] | sociability |
| Absence trigger threshold | [0.5, 4.0] days | 1 − sociability |
| Fatigue trigger threshold | [0.15, 0.30] | 1 − arousal |
| `growth.delight_count` threshold | [25, 150] | 1 − valence |
| `growth.reunion_count` threshold | [10, 60] | 1 − sociability |

### Coupling Matrix Generation

The coupling matrix is generated from a separate PRNG stream (seed+1) to avoid correlation with the trait values. The topology varies per persona:

- `energy → {mood, curiosity, focus}`: always present
- `affection → {mood}`: only if sociability > 0.5
- `curiosity → {focus}`: only if drive > 0.5
- `mood → {energy}`: only if stability > 0.6 (positive reinforcement for stable types)

If `mood → energy` coupling is added, `energy → mood` coupling is weakened by 30% and hard-capped to satisfy the stability criterion `k_me × k_em < λ²`.

### Event Sensitivity

`schema.event_sensitivity` is a per-NPC multiplier for each event's kick magnitude:

```js
// In eventsToKicks():
I = (e.intensity ?? 1) × (sens[e.type] ?? 1)
```

A character with high sociability gets a `reunion` sensitivity of up to 1.80 — reunions hit them nearly twice as hard. A character with high valence gets a `delight` sensitivity of up to 1.50. These multipliers interact with the base kick definitions, making emotionally reactive characters genuinely more reactive in the physics.

### Voice Registers

The 6th PRNG draw selects one of four voice registers. Each register defines vocabulary for all 5 variables × all 5 bands × 20 phrases = 100 phrases per register, 400 total per register, **2,000 phrases total** across all registers.

| Register | Character | Example (mood.mid) |
|----------|-----------|-------------------|
| **direct** | Minimal, Anglo-Saxon words | "steady", "level", "even" |
| **vivid** | Imagery-rich | "luminous", "sun-soaked", "a quiet glow" |
| **physiological** | Body-based | "nominal", "running at equilibrium", "baseline" |
| **social** | Relational | "present with you", "settled in", "open" |

The register is written into `schema.compiler.bands` — the engine already reads `compiler.bands` and picks phrases deterministically by state hash, so no engine change was needed. The same NPC in the same state always produces the same phrase; two NPCs with different seeds produce different phrases even in the same register, because their different baselines produce different hashes.

---

## The Standalone Package (packages/animus-persona)

`animus-persona` is scaffolded as a zero-dependency npm package. It exports:

```js
const { generatePersona, traitsFromSeed, VOICE_REGISTERS } = require('animus-persona');

// Generate a complete schema from a seed
const schema = generatePersona(12345);
// → full AnimusSchema object, ready for new Animus({ schema })

// Inspect raw traits without building a schema
const traits = traitsFromSeed(12345);
// → { valence: 0.62, arousal: 0.44, stability: 0.71, sociability: 0.83, drive: 0.55 }

// Access the full 2,000-phrase corpus
const phrases = VOICE_REGISTERS.vivid.mood.very_high;
// → ['luminous', 'sun-soaked', ...]
```

It has `animus-sdk` as an optional peer dependency — the generated schemas are plain JSON objects and can be used with any system that consumes the schema format.

---

## The Full Data Flow

A single user interaction cycle:

```
1. User sends message
2. Host calls animus.compile()
   a. tick() runs: computes elapsed steps, advances physics, checks triggers, checks growth
   b. _computeTrends() compares to last compile snapshot
   c. topMemories(3) surfaces top topics from gist() + remember()
   d. engine.compile() renders the mood-line paragraph
3. Host prepends mood-line to system prompt
4. LLM generates response (may include [[event:intensity]] tags)
5. Host calls animus.parseEvents(response) to extract tags
6. Host calls animus.cleanText(response) to get clean text for user
7. Host calls animus.apply(events) to apply emotional impact
8. Host calls animus.gist("topic1, topic2") to log conversation topics
9. State saved to disk
```

---

## What Makes It Different

**It is not a prompt hack.** Most "emotional AI" systems inject static personality descriptions or use RAG to surface relevant memories. This engine maintains actual numerical state that evolves according to differential equations, responds nonlinearly to events, and produces emergent behavior (a character who is exhausted AND has been away from a loved one will respond very differently than one who is just exhausted).

**It is physics, not rules.** There is no rule that says "if user is kind, respond warmly." Instead, kindness triggers a delight event, which kicks mood and energy, which couples forward into curiosity and focus, which the compiler surfaces as warmth and engagement. The emotional response emerges from the dynamics.

**It runs at the edges of the stack.** The engine and persona module are pure functions with zero dependencies, written in UMD format. They run identically in Node.js and the browser. A Claude.ai artifact, a React app, and a Node.js game server all use the exact same physics.

**It is designed to last.** The `step_minutes` parameter lets you control the simulation's time resolution. A 1-minute step means 240 steps of homeostasis maximum per session. For a slow-burning companion app with daily interactions, you might set it to 5 or 10 minutes. For a real-time game NPC, 0.5 minutes. The circadian clock uses real wall-clock timestamps, so a character who hasn't been spoken to for three days actually experiences three days of elapsed time.

---

## File Map

```
animus-sdk/
├── src/
│   ├── engine.js          Pure physics engine (UMD). step(), compile(),
│   │                      eventsToKicks(), circadianFactor(), band5(),
│   │                      parseEvents(), stripEventTags()
│   │
│   ├── index.js           Animus class. Persistence, wall-clock time,
│   │                      gist(), topMemories(), triggers, growth,
│   │                      trend detection, compile()
│   │
│   ├── persona.js         Persona DNA engine (UMD). mulberry32 PRNG,
│   │                      traitsFromSeed(), generateCoupling(),
│   │                      generatePersona(), VOICE_REGISTERS (2,000 phrases)
│   │
│   ├── index.d.ts         TypeScript declarations for all public API
│   │
│   └── __tests__/
│       └── animus.test.js 28 tests, 0 failures. Covers engine physics,
│                          persistence, memory, triggers, growth, persona
│                          generation, event_sensitivity, trend clauses
│
├── packages/
│   └── animus-persona/    Standalone npm package
│       ├── src/persona.js Same engine, exports VOICE_REGISTERS too
│       ├── index.js       Clean re-export entry point
│       └── index.d.ts     Full TypeScript types for persona API
│
├── templates/
│   └── agent.schema.json  Reference schema with all fields documented
│
└── bin/
    └── animus.js          CLI for inspecting and running simulations
```

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Distinct 32-bit seeds | 4,294,967,296 |
| Physics parameters varied per seed | 19+ |
| Coupling topology variants | 5 (different edge combinations) |
| Voice registers | 4 |
| Total unique phrases | 2,000 |
| Variables | 5 (mood, energy, curiosity, affection, focus) |
| State bands | 5 (very_low, low, mid, high, very_high) |
| Test cases | 28 (0 failures) |
| External dependencies | 0 (engine and persona) |
| Lines of code (src/) | ~2,000 |
| Lines of code (persona phrases) | ~1,200 |
