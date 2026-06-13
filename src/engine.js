/**
 * animus-sdk/src/engine.js  v2.1.0
 * Pure affective physics engine — UMD, zero dependencies.
 * Runs identically in Node.js, browser, and edge runtimes.
 *
 * ── Physics model ────────────────────────────────────────────────────────
 * First-order homeostasis + Ornstein-Uhlenbeck noise + circadian modulation
 * + inter-variable coupling + OCC-grounded event kicks.
 *
 * SECOND-ORDER EXTENSION: optional damped harmonic oscillator providing
 * affective inertia and hysteresis.  Kicks displace position; the oscillator
 * provides the restoring force.  Validated model (Subaharan 2026,
 * arXiv:2601.16087; see also ALMA: Gebhard 2005, WASABI: Becker-Asano 2008).
 *
 * ── Kick magnitudes ──────────────────────────────────────────────────────
 * Grounded in:
 *   OCC appraisal theory (Ortony, Clore & Collins 1988)
 *   PANAS affect schedule (Watson & Clark 1988, Table 1 item loadings)
 *   PAD space mappings (Mehrabian 1996)
 *
 * @version 2.1.0
 * @license MIT
 */
;(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.AnimusEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────

  const VARS = ['mood', 'energy', 'curiosity', 'affection', 'focus'];

  /**
   * OCC-grounded event kick table.
   * Position-displacement values (Δx) applied to state variables.
   * Scaled by event_sensitivity[type] × intensity at call site.
   *
   * Sources:
   *   delight    → OCC joy/hope (prospect-based);  PANAS: enthusiastic+excited
   *   reunion    → OCC gratitude + love;            PANAS: inspired
   *   praise     → OCC pride (self-attribution);    PANAS: proud
   *   discovery  → OCC satisfaction (goal met);     PANAS: interested+attentive
   *   play       → OCC happy-for;                   PANAS: active+alert
   *   comfort    → PAD high-pleasure, low-arousal;  PANAS: calm
   *   distress   → OCC distress (event-based);      PANAS: distressed+upset
   *   conflict   → OCC reproach/anger;              PANAS: hostile+irritable
   *   fatigue    → PANAS: tired/sluggish/drowsy
   *   rejection  → OCC shame/reproach-self;         PANAS: ashamed
   *   boredom    → PAD low-arousal, neutral valence; PANAS: sluggish
   *   frustration→ OCC displeasure;                 PANAS: jittery (negative)
   *   surprise   → OCC surprise (neutral valence);  high arousal
   *   challenge  → goal-directed tension; PANAS: determined+strong
   *   absence    → low-intensity prolonged social loss (PAD social cost)
   */
  const KICK_TABLE = {
    delight:     { mood: +0.22, energy: +0.10, curiosity: +0.08 },
    reunion:     { mood: +0.18, affection: +0.25, energy: +0.12 },
    praise:      { mood: +0.15, affection: +0.10, focus: +0.08 },
    discovery:   { curiosity: +0.28, mood: +0.10, energy: +0.08 },
    play:        { energy: +0.20, mood: +0.15, curiosity: +0.10 },
    comfort:     { mood: +0.12, affection: +0.18, energy: +0.06 },
    distress:    { mood: -0.20, energy: -0.10, focus: -0.12 },
    conflict:    { mood: -0.18, affection: -0.12, focus: -0.08 },
    fatigue:     { energy: -0.28, focus: -0.15, curiosity: -0.08 },
    rejection:   { affection: -0.22, mood: -0.15, energy: -0.08 },
    boredom:     { curiosity: -0.25, energy: -0.12, mood: -0.08 },
    frustration: { mood: -0.16, focus: -0.18, curiosity: -0.10 },
    surprise:    { curiosity: +0.20, energy: +0.10 },
    challenge:   { focus: +0.18, curiosity: +0.12, energy: -0.06 },
    absence:     { mood: -0.06, affection: -0.08 },
  };

  // ─── Math utilities ───────────────────────────────────────────────────────

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /**
   * Deterministic hash of a state vector → float in [0, 1).
   * Same state always produces same phrase; deterministic across runs.
   */
  function stateHash(state) {
    let h = 0x811c9dc5;
    for (const v of VARS) {
      const bits = Math.round(state[v] * 1e6);
      h = (Math.imul(h ^ bits, 0x01000193) >>> 0);
    }
    return (h >>> 0) / 0x100000000;
  }

  // ─── Circadian rhythm ─────────────────────────────────────────────────────

  /**
   * Circadian energy factor ∈ [floor, 1] at the given wall-clock time.
   * Sum-of-Gaussians model: each peak is a Gaussian centred on that hour,
   * sigma_hours wide, all wrapped at midnight.
   * References: Two-process model (Borbély 1982); alertness peaks ~09:00, ~14:00.
   */
  function circadianFactor(nowMs, circ) {
    const d = new Date(nowMs);
    const minOfDay = d.getHours() * 60 + d.getMinutes();
    const totalMin = 1440;
    let best = 0;
    for (const peakH of circ.peaks) {
      const peakMin = peakH * 60;
      let dist = Math.abs(minOfDay - peakMin);
      if (dist > totalMin / 2) dist = totalMin - dist;
      const sigMin = (circ.sigma_hours || 2) * 60;
      const g = Math.exp(-(dist * dist) / (2 * sigMin * sigMin));
      if (g > best) best = g;
    }
    const fl = circ.floor ?? 0.15;
    return fl + (1 - fl) * best;
  }

  /** Effective baseline for a variable at a given time (circadian-modulated). */
  function effectiveBaseline(varName, schema, nowMs) {
    const base = schema.baselines[varName];
    if (schema.circadian && schema.circadian.applies_to.includes(varName)) {
      const f = circadianFactor(nowMs, schema.circadian);
      return clamp01(lerp(base * 0.60, base * 1.15, f));
    }
    return base;
  }

  // ─── OU noise ─────────────────────────────────────────────────────────────

  /**
   * Advance Ornstein-Uhlenbeck noise by one step.
   *   ε(t) = ρ·ε(t−1) + σ·N(0,1),  clamped to ±3σ
   * Provides correlated, mean-reverting micro-fluctuations.
   * Character feels alive between events; moods drift in realistic arcs.
   */
  function stepNoise(noiseState, schema) {
    const next = {};
    const { magnitude: σ, autocorrelation: ρ } = schema.noise;
    for (const v of VARS) {
      const eps = (Math.random() * 2 - 1) * σ * Math.SQRT2;
      let n = ρ * (noiseState[v] || 0) + eps;
      const cap = 3 * σ;
      next[v] = n > cap ? cap : n < -cap ? -cap : n;
    }
    return next;
  }

  // ─── First-order step ─────────────────────────────────────────────────────

  /**
   * Single first-order step.
   *
   * x(t+1) = clamp₀₁[
   *     x(t)
   *   + λ·(x₀_eff − x(t))          ← homeostasis
   *   + Σⱼ κⱼₓ·(xⱼ − x₀ⱼ_eff)      ← coupling (deviation-based)
   *   + kick_x                       ← event displacement
   *   + εₓ(t)                        ← OU noise
   * ]
   *
   * Stability guarantee for any bidirectional coupling loop:
   *   κ₁₂ × κ₂₁ < λ²   (enforced by persona generator)
   */
  function stepFirst(state, noiseState, schema, nowMs, kicks) {
    kicks = kicks || {};
    const newNoise = stepNoise(noiseState, schema);
    const eff = {};
    for (const v of VARS) eff[v] = effectiveBaseline(v, schema, nowMs);

    const newState = {};
    for (const v of VARS) {
      const x = state[v];
      const x0 = eff[v];
      let delta = schema.homeostasis_rate * (x0 - x);

      // Inter-variable coupling (deviation from effective baseline)
      if (schema.coupling) {
        for (const [src, targets] of Object.entries(schema.coupling)) {
          if (targets[v] !== undefined) {
            delta += targets[v] * (state[src] - eff[src]);
          }
        }
      }

      delta += (kicks[v] || 0) + newNoise[v];
      newState[v] = clamp01(x + delta);
    }
    return { state: newState, noiseState: newNoise };
  }

  // ─── Second-order step ────────────────────────────────────────────────────

  /**
   * Single second-order (damped harmonic oscillator) step.
   *
   * Provides affective inertia and hysteresis:
   *   — a character who was joyful doesn't snap back; they decelerate
   *   — underdamped chars (ζ < 0.85) exhibit mild overshoot and ringing
   *   — critically damped (ζ ≈ 1) returns smoothly with no overshoot
   *
   * CORRECT kick model:
   *   Kicks displace POSITION (same as 1st-order), not acceleration.
   *   The oscillator then provides the restoring force from the elevated position.
   *   This prevents double-kicking and produces clean inertial decay curves.
   *
   * Discrete update:
   *   x_kicked = clamp₀₁(x + kick)          ← position displacement
   *   accel    = −2ζω·vel − ω²·(x_kicked − x₀) + coupling + noise
   *   vel      = clamp(vel + accel, ±v_cap)
   *   x(t+1)   = clamp₀₁(x_kicked + vel)
   *
   * ω ∈ [0.04, 0.12]  — natural frequency (stability trait)
   * ζ ∈ [0.65, 0.98]  — damping ratio (stability trait)
   * v_cap = 0.08      — velocity ceiling (prevents numerical runaway)
   */
  function stepSecond(state, velocityState, noiseState, schema, nowMs, kicks) {
    kicks = kicks || {};
    const so = schema.second_order || { natural_freq: 0.08, damping_ratio: 0.90 };
    const ω = so.natural_freq;
    const ζ = so.damping_ratio;
    const V_CAP = 0.08;

    const newNoise = stepNoise(noiseState, schema);
    const eff = {};
    for (const v of VARS) eff[v] = effectiveBaseline(v, schema, nowMs);

    const newVel   = {};
    const newState = {};

    for (const v of VARS) {
      // 1. Compute coupling as a POSITION displacement (same as 1st-order).
      //    Treating coupling as acceleration in a damped oscillator causes runaway
      //    when a kick elevates an upstream variable (e.g. energy): the coupling
      //    term keeps accelerating mood until it ceiling-sticks.
      //    Position displacement damps naturally through the oscillator's restoring force.
      let couplingDx = 0;
      if (schema.coupling) {
        for (const [src, targets] of Object.entries(schema.coupling)) {
          if (targets[v] !== undefined) {
            couplingDx += targets[v] * (state[src] - eff[src]);
          }
        }
      }

      // 2. Apply kick + coupling as position displacement, then run oscillator
      const xDisplaced = clamp01(state[v] + (kicks[v] || 0) + couplingDx + newNoise[v]);

      // 3. Damped harmonic oscillator: restoring force from displaced position
      let vel = velocityState[v] || 0;
      const accel = -2 * ζ * ω * vel
                  - ω * ω * (xDisplaced - eff[v]);

      vel = vel + accel;
      if (vel > V_CAP) vel = V_CAP;
      if (vel < -V_CAP) vel = -V_CAP;

      newVel[v]   = vel;
      newState[v] = clamp01(xDisplaced + vel);
    }
    return { state: newState, velocityState: newVel, noiseState: newNoise };
  }

  /**
   * Run N steps.  Uses second-order dynamics when schema.second_order is set.
   * Kicks are applied only on step 0.
   * Clock advances by step_minutes per step for circadian accuracy.
   */
  function runSteps(state, velocityState, noiseState, schema, nowMs, steps, kicks) {
    const useSecond = !!schema.second_order;
    let cur = { state, velocityState: velocityState || {}, noiseState };
    const stepMs = (schema.step_minutes || 1) * 60000;

    for (let i = 0; i < steps; i++) {
      const k = i === 0 ? kicks : null;
      if (useSecond) {
        const r = stepSecond(cur.state, cur.velocityState, cur.noiseState, schema, nowMs, k);
        cur = { state: r.state, velocityState: r.velocityState, noiseState: r.noiseState };
      } else {
        const r = stepFirst(cur.state, cur.noiseState, schema, nowMs, k);
        cur = { state: r.state, velocityState: cur.velocityState, noiseState: r.noiseState };
      }
      nowMs += stepMs;
    }
    return cur;
  }

  // ─── Set-point drift ──────────────────────────────────────────────────────

  /**
   * Bounded random walk on baseline set-points during absence.
   *
   * Simulates lived experience during absence: a character whose baseline
   * has drifted +0.04 mood will genuinely feel better even at homeostatic
   * equilibrium — the physics itself has changed.  Two instances of the same
   * seed with different histories diverge measurably over days.
   *
   * @param {object} baselineShifts  Current accumulated shifts (persisted in db)
   * @param {object} schema          Full AnimusSchema
   * @param {number} elapsedDays     Days since last interaction
   * @returns {object}               Updated baselineShifts (same keys as VARS)
   */
  function driftSetpoints(baselineShifts, schema, elapsedDays) {
    const cfg = schema.setpoint_drift || { max: 0.05, rate_per_day: 0.008, threshold_days: 1 };
    if (elapsedDays < cfg.threshold_days) return baselineShifts;

    const updated = Object.assign({}, baselineShifts);
    for (const v of VARS) {
      const current = updated[v] || 0;
      // Brownian step scaled by sqrt(elapsed) for proper diffusion scaling
      const step = (Math.random() * 2 - 1) * cfg.rate_per_day * Math.sqrt(elapsedDays);
      let next = current + step;
      if (next > cfg.max) next = cfg.max;
      if (next < -cfg.max) next = -cfg.max;
      updated[v] = next;
    }
    return updated;
  }

  // ─── Multi-agent social coupling ──────────────────────────────────────────

  /**
   * Compute social influence kicks from peer Animus states.
   * Models affective contagion (Mehrabian 1996, PAD social dynamics;
   * Westermann et al. 1996, mood induction via social exposure).
   *
   * Influence per peer:  kick_v = strength × (peer.state[v] − peer.baseline[v])
   * Direction: positive deviation in peer → mild positive kick in self.
   * Magnitude scaled by this character's sociability trait.
   *
   * @param {object}   selfSchema  This character's AnimusSchema
   * @param {object[]} peers       [{ state, schema, strength }]
   * @returns {object}             Aggregate kicks object
   */
  function socialInfluenceKicks(selfSchema, peers) {
    const kicks = {};
    for (const v of VARS) kicks[v] = 0;

    for (const peer of peers) {
      const s = peer.strength ?? 0.05;
      for (const v of VARS) {
        kicks[v] += s * (peer.state[v] - (peer.schema.baselines[v] ?? 0.5));
      }
    }

    // Scale by sociability — high-sociability characters absorb more peer affect
    const soc = selfSchema._traits?.sociability ?? 0.5;
    const scale = lerp(0.3, 1.3, soc);
    for (const v of VARS) kicks[v] *= scale;

    return kicks;
  }

  // ─── Event processing ─────────────────────────────────────────────────────

  /**
   * Convert event descriptors to a merged kick map.
   * kick = base_kick[v] × event_sensitivity[type] × intensity
   */
  function eventsToKicks(events, schema) {
    const merged = {};
    const sens = schema.event_sensitivity || {};
    for (const e of events) {
      const base = KICK_TABLE[e.type];
      if (!base) continue;
      const I = (e.intensity ?? 1) * (sens[e.type] ?? 1);
      for (const [v, mag] of Object.entries(base)) {
        merged[v] = (merged[v] || 0) + mag * I;
      }
    }
    return merged;
  }

  /**
   * Extract [[event:intensity]] tags from LLM response text.
   * Zero-argument: only fires for known event types in KICK_TABLE.
   * Returns [{ type, intensity }].
   */
  function parseEvents(text) {
    const re = /\[\[(\w+)(?::([0-9.]+))?\]\]/g;
    const events = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      if (KICK_TABLE[m[1]]) {
        events.push({ type: m[1], intensity: m[2] ? parseFloat(m[2]) : 1 });
      }
    }
    return events;
  }

  /** Remove [[event:intensity]] tags from response text. */
  function stripEventTags(text) {
    return text.replace(/\[\[[\w:0-9.]+\]\]/g, '').replace(/\s{2,}/g, ' ').trim();
  }

  /**
   * Zero-config event inference from raw LLM text.
   * Used when the host does not modify its prompts to emit [[event]] tags.
   * Intensities are attenuated (0.35–0.55) to avoid over-reacting to soft signals.
   * Returns same format as parseEvents().
   */
  function inferEvents(text) {
    const t = text.toLowerCase();
    const signals = [
      { re: /\b(wonderful|fantastic|joy(?:ful)?|thrill|excit\w*|delight\w*|happy|love it|great news)\b/, type: 'delight',     i: 0.50 },
      { re: /\b(thank you|grateful|appreciate|means a lot|glad you|welcome back|missed you)\b/,         type: 'reunion',     i: 0.45 },
      { re: /\b(well done|proud|great work|impressive|brilliant|nailed it)\b/,                          type: 'praise',      i: 0.45 },
      { re: /\b(intriguing|curious|interesting|wonder\w*|fascinat\w*|discover\w*|tell me more)\b/,      type: 'discovery',   i: 0.45 },
      { re: /\b(laugh\w*|play\w*|fun|enjoy\w*|lighthearted|joke)\b/,                                    type: 'play',        i: 0.40 },
      { re: /\b(sad|sorry|difficult|hard time|unfortunate|disappoint\w*|hurt\w*)\b/,                    type: 'distress',    i: 0.40 },
      { re: /\b(disagree|conflict|wrong|unfair|ang(?:er|ry)|frustrat\w*|upset)\b/,                      type: 'conflict',    i: 0.40 },
      { re: /\b(tired|exhaust\w*|worn out|drain\w*|weary|fatigue\w*|can't go on)\b/,                    type: 'fatigue',     i: 0.45 },
      { re: /\b(reject\w*|ignor\w*|dismiss\w*|don't care|not interested|brush\w* off)\b/,               type: 'rejection',   i: 0.38 },
      { re: /\b(bor(?:ed|ing|edom)|monoton\w*|dull|same old|tedious)\b/,                                type: 'boredom',     i: 0.38 },
      { re: /\b(challeng\w*|difficult|complex|stretch\w*|push\w* you)\b/,                               type: 'challenge',   i: 0.38 },
      { re: /\b(surpris\w*|unexpect\w*|sudden\w*|oh!|wow|wait—|didn't see that)\b/,                     type: 'surprise',    i: 0.42 },
    ];
    const hits = [];
    for (const s of signals) {
      if (s.re.test(t)) hits.push({ type: s.type, intensity: s.i });
    }
    return hits;
  }

  // ─── Natural-language compiler ────────────────────────────────────────────

  /** Map value ∈ [0,1] to 5-band label. */
  function band5(x) {
    if (x < 0.15) return 'very_low';
    if (x < 0.35) return 'low';
    if (x < 0.65) return 'mid';
    if (x < 0.85) return 'high';
    return 'very_high';
  }

  /**
   * Compile state vector → natural-language mood-line paragraph.
   *
   * Algorithm:
   *  1. Score each variable by |value − effective_baseline|
   *  2. Mention all with |dev| ≥ 0.08, at most 3, most-deviated first
   *  3. If nothing notable, mention the single most-deviated variable
   *  4. Append trend clause if lead variable shifted > 0.03 since last compile
   *  5. Append circadian time context
   *  6. Append memory gist (top N topics)
   *
   * Phrase selection is deterministic: stateHash(state) indexes into the band.
   * Same state → same phrase every time; stable for tests and reproducible voice.
   */
  function compile(state, schema, nowMs, prevState, memories) {
    const bands = (schema.compiler && schema.compiler.bands) ? schema.compiler.bands : DEFAULT_BANDS;

    const eff = {};
    for (const v of VARS) eff[v] = effectiveBaseline(v, schema, nowMs);

    const scored = VARS
      .map(v => ({ v, dev: state[v] - eff[v], absDev: Math.abs(state[v] - eff[v]) }))
      .sort((a, b) => b.absDev - a.absDev);

    const notable = scored.filter(s => s.absDev >= 0.08).slice(0, 3);
    if (notable.length === 0) notable.push(scored[0]);

    const hash = stateHash(state);
    const phrases = notable.map(s => {
      const b = band5(state[s.v]);
      const pool = (bands[s.v] && bands[s.v][b]) ? bands[s.v][b] : DEFAULT_BANDS[s.v][b];
      return pool[Math.floor(hash * pool.length) % pool.length];
    });

    let line = phrases.join('; ') + '.';

    // Trend clause
    if (prevState) {
      const delta = state[notable[0].v] - prevState[notable[0].v];
      if (delta > 0.03) line += ' Lifting.';
      else if (delta < -0.03) line += ' Still sliding.';
    }

    // Circadian time context
    if (schema.circadian) {
      const cf = circadianFactor(nowMs, schema.circadian);
      const h = new Date(nowMs).getHours();
      let tc;
      if      (h >= 5  && h < 10) tc = cf > 0.6 ? "It's morning, one of your sharper stretches." : "It's early — not quite firing yet.";
      else if (h >= 10 && h < 13) tc = "It's mid-morning, usually a focused window.";
      else if (h >= 13 && h < 16) tc = cf > 0.7 ? "It's midday, one of your more engaged times." : "The afternoon dip is setting in.";
      else if (h >= 16 && h < 20) tc = "It's late afternoon — winding down.";
      else if (h >= 20 && h < 23) tc = "It's evening, a quieter time.";
      else                         tc = "It's the middle of the night, a low-energy stretch.";
      line += ' ' + tc;
    }

    // Memory gist
    if (memories && memories.length > 0) {
      line += ` You've been thinking about ${memories.slice(0, 3).join(', ')} lately.`;
    }

    return line;
  }

  // ─── Diagnostic ───────────────────────────────────────────────────────────

  /** Full diagnostic snapshot — for CLI and playground. */
  function diagnose(state, velocityState, noiseState, schema, nowMs) {
    const eff = {};
    for (const v of VARS) eff[v] = effectiveBaseline(v, schema, nowMs);
    const cf = schema.circadian ? circadianFactor(nowMs, schema.circadian) : null;

    return {
      timestamp:            new Date(nowMs).toISOString(),
      circadianFactor:      cf,
      variables: VARS.map(v => ({
        name:              v,
        value:             state[v],
        baseline:          schema.baselines[v],
        effectiveBaseline: eff[v],
        deviation:         state[v] - eff[v],
        velocity:          velocityState ? (velocityState[v] ?? 0) : 0,
        noise:             noiseState   ? (noiseState[v]   ?? 0) : 0,
        band:              band5(state[v]),
      })),
      secondOrderEnabled:   !!schema.second_order,
      setpointDriftEnabled: !!schema.setpoint_drift,
    };
  }

  // ─── Default phrase bands (fallback; full corpus in persona.js) ───────────

  const DEFAULT_BANDS = {
    mood: {
      very_low: ['dark', 'bleak', 'heavy', 'grim'],
      low:      ['subdued', 'flat', 'muted', 'dim'],
      mid:      ['steady', 'level', 'even', 'settled'],
      high:     ['bright', 'warm', 'lifted', 'good'],
      very_high:['elated', 'luminous', 'alive', 'light'],
    },
    energy: {
      very_low: ['drained', 'spent', 'empty', 'hollow'],
      low:      ['sluggish', 'weary', 'slow', 'worn'],
      mid:      ['nominal', 'present', 'awake', 'running okay'],
      high:     ['alert', 'energized', 'clear', 'on'],
      very_high:['charged', 'buzzing', 'sharp', 'fully awake'],
    },
    curiosity: {
      very_low: ['disengaged', 'incurious', 'flat', 'blank'],
      low:      ['low interest', 'quiet', 'thin', 'dim'],
      mid:      ['paying attention', 'engaged', 'curious', 'here'],
      high:     ['genuinely curious', 'leaning in', 'tuned in', 'turned toward this'],
      very_high:['fascinated', 'pulled in', 'lit up', 'intensely interested'],
    },
    affection: {
      very_low: ['distant', 'closed', 'withdrawn', 'cold'],
      low:      ['reserved', 'guarded', 'careful', 'cool'],
      mid:      ['open', 'present with you', 'settled in', 'warm enough'],
      high:     ['fond', 'warm', 'close', 'caring'],
      very_high:['deeply fond', 'attached', 'full of warmth', 'genuinely close'],
    },
    focus: {
      very_low: ['scattered', 'drifting', 'unfocused', 'lost'],
      low:      ['partial attention', 'thin', 'not quite here', 'distracted'],
      mid:      ['tracking fine', 'mostly here', 'reasonably focused', 'on it'],
      high:     ['focused', 'locked in', 'clear-headed', 'sharp'],
      very_high:['razor-sharp', 'deep in it', 'fully concentrated', 'locked'],
    },
  };

  // ─── Public API ───────────────────────────────────────────────────────────

  return {
    VARS,
    KICK_TABLE,
    clamp01,
    lerp,
    stateHash,
    circadianFactor,
    effectiveBaseline,
    stepNoise,
    stepFirst,
    stepSecond,
    runSteps,
    driftSetpoints,
    socialInfluenceKicks,
    eventsToKicks,
    parseEvents,
    stripEventTags,
    inferEvents,
    band5,
    compile,
    diagnose,
    DEFAULT_BANDS,
  };
});
