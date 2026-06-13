# animus-sdk

> The affective state engine for AI characters. Memory tells your agent what it knows — Animus tells it how it *is*.

[![npm](https://img.shields.io/badge/npm-animus--sdk-blue)](https://www.npmjs.com/package/animus-sdk)

**[▶ Live simulator — no install needed](https://kahnark89.github.io/animus-sdk)**

> *"You're steady; low-energy, quiet; interested; fond; on task. It's late evening, a low-energy stretch of your day."* — compiled at 2:49 AM from the circadian engine reading the real clock

---

## The category gap

The agent-memory market is solved and crowded — Mem0, Letta, Zep, Graphiti all give your agent *facts*: who the user is, what was said, what changed. Plug one in and your agent remembers everything.

And it still feels dead.

Because memory is not the missing layer. **Affect is.** A character with perfect recall and no internal state is a database with a voice. What makes a companion, an NPC, or an assistant feel alive isn't what it knows — it's that it has a *now*: a mood that today's events pushed off baseline, energy that follows a daily rhythm, a state that was different yesterday and will drift again tomorrow.

No memory layer models that. Animus is the layer that does.

```
What it knows        →  memory layer   (Mem0, Letta, Zep — keep yours)
How it is right now  →  ANIMUS         (this package)
How it speaks        →  the LLM        (any vendor, swappable)
```

Animus is **not** a memory product and doesn't compete with one. It composes with all of them.

---

## The Pattern

> **The state engine (soul) and the LLM (mouth) are different systems, connected by one narrow compiled interface.**

```
State Engine (local, persistent, offline)
├── continuous state variables (mood, energy, curiosity, affection, focus)
├── homeostasis + coupling equations
├── event kick system
├── circadian rhythm
└── episodic memory
         ↓ compile ↓
      mood-line paragraph
"You're feeling bright and curious. It's midday, your most engaged time.
 You've been thinking about the auth module lately."
         ↓
      LLM call — conditions on mood-line, speaks, returns response
         ↓
      parse events → feed back into state engine
```

The LLM never touches state directly. The mood-line is the only interface. That one constraint buys you everything below:

- **Vendor-portable personality.** The state lives in your files, not a vendor's system prompt. Swap Claude for Gemini for a local model mid-week — the character wakes up the same character.
- **Tunable by physics, not prose.** "Make her moods last longer" is one parameter (λ), not a prompt-engineering session.
- **Offline-capable aliveness.** State updates need zero network calls. The character's inner life keeps running when the cloud doesn't.
- **Deterministic and inspectable.** Every state change traces to an event or an equation. No "the model decided to be sad today."

---

## Who this is for

**1. AI companion products.** Your retention problem is a flatness problem: users churn when the character feels like the same vending machine every session. Animus gives each user's companion a persistent, drifting, circadian inner life — per-user, on your infrastructure, portable across model upgrades.

**2. Game NPCs.** Emotional arcs across play sessions without scripting them. An NPC who is still rattled tomorrow by what the player did today — driven by a 5-variable dynamical system, not a dialogue tree.

**3. AI pair programmers / desktop assistants.** Time-of-day energy, session momentum, focus state. The difference between a tool and a colleague.

The qualifying complaint is always the same: *"it feels dead, and better prompting hasn't fixed it."* Correct — prompting can't fix it, because it's an architecture problem.

---

## Quickstart

```bash
npm install animus-sdk
npx animus init          # scaffold animus/agent.schema.json + AGENTS.md snippet
```

```typescript
import { Animus } from 'animus-sdk';

const agent = new Animus({
  schema: './animus/agent.schema.json',
  memory: './animus/agent.memory.db'
});

// Before your LLM call — inject compiled state
const moodLine = agent.compile();
const messages = [
  { role: 'system', content: `${baseSystemPrompt}\n\n${moodLine}` },
  ...conversationHistory
];

// Your existing LLM call — unchanged
const response = await anthropic.messages.create({ messages, model: 'claude-opus-4-8', max_tokens: 1024 });

// After — feed events back into the state engine
agent.apply(parseEvents(response.content));
```

Works with Anthropic SDK, OpenAI SDK, Google Gemini, Ollama, or any HTTP LLM endpoint. Three lines around the LLM call you already have.

---

## State Schema

Define your agent's state as a JSON file:

```json
{
  "name": "my-agent",
  "variables": ["mood", "energy", "curiosity", "affection", "focus"],
  "baselines": {
    "mood": 0.65, "energy": 0.70, "curiosity": 0.75, "affection": 0.50, "focus": 0.60
  },
  "homeostasis_rate": 0.08,
  "coupling": {
    "energy": { "mood": 0.30, "curiosity": 0.25, "focus": 0.20 }
  },
  "circadian": {
    "peaks": ["09:00", "14:00"],
    "floor": 0.15
  },
  "noise": { "magnitude": 0.02, "autocorrelation": 0.7 }
}
```

---

## Update Equation

```
x(t+1) = clamp01(
    x(t)
  + λ · (x₀_eff − x(t))        # homeostasis: return toward baseline
  + Σ κ_xj · (xj(t) − xj*)     # coupling: other variables pull on x
  + event_kick(t)               # event spike: what just happened
  + ε(t)                        # bounded autocorrelated noise
)
```

**λ ≈ 0.08** is the master feel knob. Higher = moods recover faster. Lower = states linger longer.

---

## Event System

```typescript
// Built-in event types
agent.apply([
  { type: 'delight',   intensity: 0.8 },  // +mood, +energy
  { type: 'confusion', intensity: 0.5 },  // -curiosity, slight -mood
  { type: 'reunion',   intensity: 1.0 },  // +affection, +mood, +energy
  { type: 'fatigue',   intensity: 0.6 },  // -energy (drags all via coupling)
]);

// Custom event types in schema
"events": {
  "breakthrough": { "mood": 0.25, "energy": 0.15, "curiosity": -0.10 },
  "blocked":      { "mood": -0.15, "focus": -0.20 }
}
```

---

## Mood-Line Compiler

The compiler converts live state into a natural-language paragraph before each LLM call:

```typescript
agent.compile();
// → "You're feeling bright and bouncy; energy is high. You're fascinated and full of questions.
//    It's midday, your most energetic time. You've been thinking about the auth module lately."
```

Customize band labels and vocabulary per agent in the schema (flat per-variable keys are canonical; a nested `bands` object is also accepted). Set `"memory_injection": false` to keep episodic memory out of the mood-line:

```json
"compiler": {
  "mood":   { "low": "a bit flat", "mid": "steady", "high": "bright and joyful" },
  "energy": { "low": "low-energy", "mid": "focused", "high": "bouncy and energized" }
}
```

---

## Animus alongside a memory layer

| Layer | Question it answers | Examples |
|---|---|---|
| Memory | "What do I know about this user/world?" | Mem0, Letta, Zep, Graphiti |
| **Animus** | **"What state am I in right now?"** | **this package** |
| LLM | "What do I say?" | any vendor |

```typescript
const messages = [
  { role: 'system', content: [
      baseSystemPrompt,
      agent.compile(),                    // Animus: how it is
      await mem0.getRelevant(userInput),  // memory layer: what it knows
    ].join('\n\n') },
  ...history
];
```

---

## What You Get

| Without Animus | With Animus |
|---|---|
| Persona in system prompt | Persona in state engine — truly persistent |
| Identical across sessions (dead) | State-driven across sessions (alive) |
| Vendor-locked | Swap LLMs freely — state is yours |
| Falls silent offline | Degrades gracefully offline |
| Tuned by prompting | Tuned by physical parameters |
| Personality is rented | Personality is owned |

---

## CLI

```bash
npx animus init        # scaffold animus/ in current project
npx animus simulate    # build animus/simulator.html — the live engine on your schema
npx animus status      # show schema, λ, and persisted state
```

`simulate` generates one self-contained HTML file with the *shipping* engine (same `engine.js` that runs in Node) inlined against your schema — open it in any browser, kick events, drag λ, and watch the traces and the compiled mood-line respond. No server, no build step.

---

## Closing the loop: event tags

Tell your LLM (in its system prompt) to annotate emotionally significant moments with `[[event]]` or `[[event:intensity]]` tags. `parseEvents` extracts only event names defined in your schema or the built-ins — **raw LLM text can never invent a state change** — and `cleanText` strips the tags before you show the reply:

```typescript
const reply  = response.content[0].text;        // "You fixed it! [[delight:0.9]]"
agent.apply(agent.parseEvents(reply));           // state engine absorbs the moment
display(agent.cleanText(reply));                 // "You fixed it!"
```

---

## Roadmap

- Python binding (`AnimusMemory` for LangChain / LlamaIndex)
- Streaming event parser for token-by-token responses
- Multi-agent shared-world coupling

---

## Provenance

Animus extracts the "Living Engine" built for Prism, a learning environment for young children whose design bar was unusually high: a four-year-old must believe its characters are alive on day 40, on a device that must keep its inner life running offline, with every influence on the child inspectable by a parent. The soul/mouth separation, the update equation, and the mood-line compiler all came out of meeting that bar. The pattern is domain-general.

*Capps Consulting Company LLC*
