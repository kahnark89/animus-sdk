/* animus engine — pure logic, no I/O, no deps. UMD: same file runs in Node + browser.
 * All functions are pure: (state, schema, opts) in → new state out. Persistence lives in index.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnimusEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BUILTIN_EVENTS = {
    delight:      { mood: 0.20, energy: 0.10 },
    confusion:    { curiosity: -0.15, mood: -0.05 },
    reunion:      { affection: 0.25, mood: 0.20, energy: 0.15 },
    fatigue:      { energy: -0.25 },
    long_absence: { affection: -0.08, mood: -0.05 }
  };

  var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };

  // Box–Muller gaussian. rng = () => [0,1) (injectable for tests).
  function randn(rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function minutesOfDay(date) { return date.getHours() * 60 + date.getMinutes(); }

  // Circadian multiplier in [floor, 1]: max of gaussians centered on schema peaks.
  function circadianFactor(schema, date) {
    var c = schema.circadian;
    if (!c || !c.peaks || !c.peaks.length) return 1;
    var floor = c.floor != null ? c.floor : 0.15;
    var sigma = c.width_minutes || 150;
    var now = minutesOfDay(date), best = 0;
    for (var i = 0; i < c.peaks.length; i++) {
      var p = c.peaks[i].split(':');
      var pm = (+p[0]) * 60 + (+p[1] || 0);
      var d = Math.abs(now - pm);
      if (d > 720) d = 1440 - d; // wrap midnight
      var g = Math.exp(-(d * d) / (2 * sigma * sigma));
      if (g > best) best = g;
    }
    return floor + (1 - floor) * best;
  }

  // Shared: effective setpoints adjusted for circadian rhythm.
  // Used by both step() and compile() so they agree on what "baseline" means.
  function effectiveBaselines(schema, date) {
    var circVars = (schema.circadian && schema.circadian.applies_to) || ['energy'];
    var circ = circadianFactor(schema, date);
    var eff = {};
    schema.variables.forEach(function (x) {
      var base = schema.baselines[x] != null ? schema.baselines[x] : 0.5;
      eff[x] = circVars.indexOf(x) !== -1 ? base * circ : base;
    });
    return eff;
  }

  function eventDefs(schema) {
    var defs = {}, k;
    for (k in BUILTIN_EVENTS) defs[k] = BUILTIN_EVENTS[k];
    if (schema.events) for (k in schema.events) defs[k] = schema.events[k];
    return defs;
  }

  // events: [{type, intensity?}] → per-variable summed kicks.
  function eventsToKicks(events, schema) {
    var defs = eventDefs(schema), kicks = {};
    (events || []).forEach(function (e) {
      var def = defs[e.type];
      if (!def) return;
      var I = e.intensity != null ? e.intensity : 1;
      for (var v in def) kicks[v] = (kicks[v] || 0) + def[v] * I;
    });
    return kicks;
  }

  /* One step of the update equation:
   * x(t+1) = clamp01( x + λ(x₀_eff − x) + Σ κ_jx(x_j − x_j*) + kick + ε )
   * Schema coupling is keyed by SOURCE: coupling.energy.mood = how energy's deviation pulls mood.
   * noiseState (ε per variable) is autocorrelated: ε' = ρε + mag·N(0,1), clamped to ±3·mag. */
  function step(state, schema, opts) {
    opts = opts || {};
    var date = opts.date || new Date();
    var rng = opts.rng || Math.random;
    var kicks = opts.kicks || {};
    var noise = opts.noiseState || {};
    var lam = schema.homeostasis_rate != null ? schema.homeostasis_rate : 0.08;
    var nMag = (schema.noise && schema.noise.magnitude) || 0;
    var rho = (schema.noise && schema.noise.autocorrelation) || 0;
    var next = {}, nextNoise = {};
    var eff = effectiveBaselines(schema, date);

    schema.variables.forEach(function (x) {
      var x0 = eff[x];
      var v = state[x] != null ? state[x] : x0;

      var couple = 0;
      if (schema.coupling) {
        for (var src in schema.coupling) {
          var k = schema.coupling[src][x];
          if (k && src !== x) {
            couple += k * ((state[src] != null ? state[src] : eff[src]) - eff[src]);
          }
        }
      }

      var eps = 0;
      if (nMag > 0) {
        eps = rho * (noise[x] || 0) + nMag * randn(rng);
        var lim = 3 * nMag;
        eps = eps < -lim ? -lim : eps > lim ? lim : eps;
      }
      nextNoise[x] = eps;
      next[x] = clamp01(v + lam * (x0 - v) + couple + (kicks[x] || 0) + eps);
    });
    return { state: next, noiseState: nextNoise };
  }

  // ── mood-line compiler ────────────────────────────────────────────────────
  // 5-band vocab with phrase arrays. compile() surfaces only variables that are
  // notably deviated from their effective baseline, leading with the most extreme.
  // Phrase selection uses a deterministic state hash — no rng needed, tests are stable.

  var DEFAULT_VOCAB = {
    mood: {
      very_low: ['genuinely low', 'carrying something heavy', 'at a real low point'],
      low:      ['a bit flat', 'subdued', 'not quite itself'],
      mid:      ['steady', 'level', 'even-keeled'],
      high:     ['bright', 'in a good place', 'lifted'],
      very_high: ['genuinely lit up', 'running unusually bright', 'in an uncommonly good place']
    },
    energy: {
      very_low: ['running on empty', 'barely keeping up', 'depleted'],
      low:      ['low on energy', 'sluggish', 'dragging a bit'],
      mid:      ['comfortably paced', 'holding steady', 'moving at a reasonable pace'],
      high:     ['energized', 'sharp and present', 'with good momentum'],
      very_high: ['buzzing', 'unusually sharp today', 'running hot']
    },
    curiosity: {
      very_low: ['mentally closed off', 'not reaching for anything new', 'flat on curiosity'],
      low:      ['not very curious right now', 'a bit incurious', 'not reaching much'],
      mid:      ['mildly curious', 'open enough', 'quietly interested'],
      high:     ['genuinely curious', 'reaching', 'leaning in'],
      very_high: ['fascinated', 'full of questions', 'lit by the topic']
    },
    affection: {
      very_low: ['distant', 'a little cold today', 'closed off'],
      low:      ['a little distant', 'not especially warm', 'holding back'],
      mid:      ['warm', 'comfortable', 'at ease'],
      high:     ['fond', 'genuinely warm', 'feeling close'],
      very_high: ['deeply fond', 'really enjoying this company', 'unusually warm']
    },
    focus: {
      very_low: ['scattered', 'attention all over the place', 'losing the thread'],
      low:      ['a bit scattered', 'not quite locked in', 'drifting'],
      mid:      ['reasonably focused', 'tracking well', 'keeping pace'],
      high:     ['focused', 'locked in', 'on it'],
      very_high: ['dialed in', 'in a focused flow', 'unusually on-task']
    }
  };

  // Integer hash of state vector for deterministic phrase selection.
  function stateHash(state) {
    var h = 0, keys = Object.keys(state).sort();
    for (var i = 0; i < keys.length; i++) {
      h = (h * 31 + Math.round((state[keys[i]] || 0) * 1000)) | 0;
    }
    return h < 0 ? -h : h;
  }

  // Pick from string or array; string = backward-compat 3-band vocab.
  function pickPhrase(entry, seed) {
    if (!entry) return null;
    if (typeof entry === 'string') return entry;
    if (Array.isArray(entry)) return entry[seed % entry.length];
    return null;
  }

  function band5(v) {
    if (v < 0.15) return 'very_low';
    if (v < 0.35) return 'low';
    if (v < 0.65) return 'mid';
    if (v < 0.85) return 'high';
    return 'very_high';
  }

  // 3-band kept for backward compat (engine API).
  function band(v, t) {
    t = t || [0.33, 0.66];
    return v < t[0] ? 'low' : v < t[1] ? 'mid' : 'high';
  }

  function timePhrase(schema, date) {
    var f = circadianFactor(schema, date), h = date.getHours();
    var part = h < 5 ? 'the middle of the night' : h < 12 ? 'morning' : h < 17 ? 'midday' : h < 21 ? 'evening' : 'late evening';
    if (f > 0.8) return "It's " + part + ', one of your more engaged times.';
    if (f < 0.35) return "It's " + part + ', a low-energy stretch.';
    return "It's " + part + '.';
  }

  /* compile(state, schema, {date, memory, trends}) → the mood-line paragraph.
   * opts.trends = { variable: 'rising'|'falling' } supplied by index.js from compile deltas.
   * This string is the ONLY thing the LLM ever sees of the state engine. */
  function compile(state, schema, opts) {
    opts = opts || {};
    var date = opts.date || new Date();
    var trends = opts.trends || {};
    var th3 = (schema.compiler && schema.compiler.thresholds) || [0.33, 0.66];
    var eff = effectiveBaselines(schema, date);
    var hash = stateHash(state);
    var NOTABLE = 0.08; // minimum deviation from effective baseline to mention a variable

    // Score variables by distance from effective baseline; most notable first.
    var scored = schema.variables.map(function (x) {
      var v = state[x] != null ? state[x] : eff[x];
      return { name: x, value: v, dev: Math.abs(v - eff[x]) };
    }).sort(function (a, b) { return b.dev - a.dev; });

    // Mention up to 3 notable variables; always at least 1.
    var toMention = scored.filter(function (s) { return s.dev >= NOTABLE; });
    if (!toMention.length) toMention = [scored[0]];
    if (toMention.length > 3) toMention = toMention.slice(0, 3);

    var parts = [];
    toMention.forEach(function (item, i) {
      var x = item.name, v = item.value;
      var c = schema.compiler || {};
      // vocab lookup: c.bands[x] (new) → c[x] (flat legacy) → DEFAULT_VOCAB[x] (built-in)
      var vocab = (c.bands && c.bands[x]) || c[x] || DEFAULT_VOCAB[x];
      if (!vocab) return;
      // 5-band if vocab has very_low or very_high; otherwise fall back to 3-band for compat.
      var has5 = vocab.very_low != null || vocab.very_high != null;
      var b = has5 ? band5(v) : band(v, th3);
      var phrase = pickPhrase(vocab[b], hash + i * 7);
      if (phrase) parts.push(phrase);
    });

    var stateLine = parts.length ? "You're " + parts.join('; ') + '.' : '';

    // Trend clause for the lead variable when it's in clear motion.
    var leadTrend = trends[scored[0].name];
    var trendClause = leadTrend === 'rising' ? ' Lifting.' : leadTrend === 'falling' ? ' Still sliding.' : '';

    var line = (stateLine + trendClause + ' ' + timePhrase(schema, date)).trim();
    if (opts.memory) line += " You've been thinking about " + opts.memory + ' lately.';
    return line;
  }

  /* parseEvents(text, schema) → events found in LLM output.
   * Convention: the LLM emits [[event_name]] or [[event_name:0.8]] tags.
   * Unknown event names are ignored — raw text can never modify state (invariant 2). */
  function parseEvents(text, schema) {
    var defs = eventDefs(schema || {}), out = [], m;
    var re = /\[\[([a-z_][a-z0-9_]*)(?::(\d*\.?\d+))?\]\]/g;
    while ((m = re.exec(text || '')) !== null) {
      if (defs[m[1]]) out.push({ type: m[1], intensity: m[2] != null ? +m[2] : 1 });
    }
    return out;
  }

  function stripEventTags(text) {
    return (text || '').replace(/\[\[[a-z_][a-z0-9_]*(?::\d*\.?\d+)?\]\]/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  }

  return {
    step: step, eventsToKicks: eventsToKicks, compile: compile, band: band, band5: band5,
    parseEvents: parseEvents, stripEventTags: stripEventTags,
    circadianFactor: circadianFactor, effectiveBaselines: effectiveBaselines,
    BUILTIN_EVENTS: BUILTIN_EVENTS, clamp01: clamp01
  };
});
