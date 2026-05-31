# animus-sdk

> Persistent AI state layer — decouple your agent's soul from the LLM

[![npm](https://img.shields.io/badge/npm-animus--sdk-blue)](https://www.npmjs.com/package/animus-sdk)

---

## The Problem

Every AI agent or chatbot built on an LLM shares the same structural defect: the model is stateless, consistent, and always-available — which is exactly why it feels dead.

The standard fix is more prompting: longer persona descriptions, injected conversation history, memory APIs. None of it works because the fix is aimed at the wrong layer. The LLM is not broken. The architecture is wrong.

**Standard approach:**
```
User input → [system prompt + history] → LLM → response
                     ↑
            persona lives here — vendor-locked, stateless, flat
```

This produces agents that are vendor-locked, inconsistent across sessions, flat (no rhythm, no organic change), and offline-incapable.

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

The LLM never touches state directly. The mood-line is the only interface.

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

Works with Anthropic SDK, OpenAI SDK, Google Gemini, Ollama, or any HTTP LLM endpoint.

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

Customise band labels and vocabulary per agent in the schema:

```json
"compiler": {
  "mood":   { "low": "a bit flat", "mid": "steady", "high": "bright and joyful" },
  "energy": { "low": "low-energy", "mid": "focused", "high": "bouncy and energised" }
}
```

---

## What You Get

| Without Animus | With Animus |
|---|---|
| Persona in system prompt | Persona in state engine — truly persistent |
| Consistent across sessions (dead) | State-driven across sessions (alive) |
| Vendor-locked | Swap LLMs freely — state is yours |
| Falls silent offline | Degrades gracefully offline |
| Tuned by prompting | Tuned by physical parameters |
| Personality is rented | Personality is owned |

---

## CLI

```bash
npx animus init        # scaffold animus/ in current project
npx animus simulate    # open browser simulator (React)
npx animus status      # print current state variables
```

---

## LangChain / LlamaIndex

```python
from animus import AnimusMemory

memory = AnimusMemory(schema="animus/agent.schema.json")
chain = ConversationChain(llm=llm, memory=memory)
```

---

## Target Use Cases

- AI companions / assistants that need to feel consistent and growing over time
- Game NPCs with genuine emotional arcs
- Developer tools (AI pair programmers) that reflect time-of-day and session context
- Any agent where "it feels dead" is a blocking complaint and better prompting hasn't fixed it

---

## Derived from Prism

Animus implements the soul/mouth separation architecture developed for the Prism children's learning companion. The state engine, update equation, and mood-line compiler are direct extractions. The pattern is domain-general.

*Capps Consulting Company LLC*
