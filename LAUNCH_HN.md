**TITLE (copy this exactly into the HN title field):**
Show HN: Animus – mood physics for AI characters (not another memory layer)

**URL (paste into the HN URL field):**
https://kahnark89.github.io/animus-sdk

**FIRST COMMENT (post this within 60 seconds of submitting — open the comment box
before you submit so you can paste fast):**

Author here. Quick context on why this exists.

I kept hitting the same wall building AI characters: memory layers (Mem0, Letta,
Zep) solve what the agent *knows*, but nothing models how it *is right now*. A
character with perfect recall still feels like the same vending machine every
session.

The root problem: there's no internal state between calls. Each LLM call starts
blank. Prompting around it doesn't work — you can describe a mood, but the
description resets every turn and can't drift, recover, or compound across a
conversation the way a real emotional state does.

Animus is a small dynamical-systems state engine that runs beside the LLM:

- 5 coupled continuous variables (mood, energy, curiosity, affection, focus)
- One update equation per step: homeostasis toward baseline + cross-variable
  coupling + event kicks + circadian rhythm + bounded autocorrelated noise
- Before each LLM call: compiles to one natural-language paragraph injected
  into the system prompt
- After each LLM call: parses [[event:intensity]] tags back into the engine

The LLM never touches state values directly — that constraint makes personality
vendor-portable (swap Claude for Gemini, the character wakes up the same
character), offline-capable (state updates need zero network calls), and tunable
by parameters instead of prompt surgery.

The simulator at the linked URL IS the shipping engine — a UMD file, same code in
Node and browser. The circadian system reads the real clock: it knew it was late
evening at 2:49 AM and called the energy correctly.

npm install animus-sdk
repo: github.com/kahnark89/animus-sdk

Honest open question: the coupling matrix is hand-tuned. Has anyone fit
affect-dynamics parameters from real interaction data, or is there a corpus
that would work for that?

---

**IF YOU GET THIS OBJECTION — "This is just prompt engineering":**

You can describe a mood, but descriptions don't behave like state. Three things
prompt-based mood can't do:
1. Drift and recover autonomously between calls without LLM involvement
2. Persist correctly across model swaps — the state file is yours, swap vendors
   and the character's history comes with it
3. Compound: fatigue dragging mood which drags focus isn't a sentence, it's a
   system of equations

**IF YOU GET THIS OBJECTION — "Why 5 variables? Seems arbitrary":**

The 5 defaults cover the main axes from affect research. But they're just
defaults — the schema is a JSON file you control. Define any variables, any
coupling coefficients, any event vocabulary. The equation doesn't know or care
what you name them.

**IF YOU GET THIS OBJECTION — "The math is too simple to model real emotion":**

Deliberately. The goal isn't to model real emotion — it's to create the
appearance of consistent inner state to an LLM that fills in the psychological
complexity from there. Keeping the math simple means every parameter is
inspectable and tunable. There's no black box between "I want this character to
be moodier" and the knob that does it (λ).
