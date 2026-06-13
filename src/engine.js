/* animus engine — pure logic, no I/O, no deps. UMD: same file runs in Node + browser.
 * All functions are pure: (state, schema, opts) in → new state out. Persistence lives in index.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnimusEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BUILTIN_EVENTS = {
    delight:   { mood: 0.20, energy: 0.10 },
    confusion: { curiosity: -0.15, mood: -0.05 },
    reunion:   { affection: 0.25, mood: 0.20, energy: 0.15 },
    fatigue:   { energy: -0.25 }
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
    var circVars = (schema.circadian && schema.circadian.applies_to) || ['energy'];
    var circ = circadianFactor(schema, date);
    var next = {}, nextNoise = {};

    // Effective setpoints x* (circadian-adjusted). Coupling MUST reference these,
    // not raw baselines — otherwise a normal circadian dip reads as a permanent
    // deviation and biases every coupled variable off its equilibrium.
    var eff = {};
    schema.variables.forEach(function (x) {
      var base = schema.baselines[x] != null ? schema.baselines[x] : 0.5;
      eff[x] = circVars.indexOf(x) !== -1 ? base * circ : base;
    });

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
  var DEFAULT_VOCAB = {
    mood:      { low: 'feeling a bit flat', mid: 'feeling steady', high: 'feeling bright and upbeat' },
    energy:    { low: 'low on energy', mid: 'comfortably energetic', high: 'full of energy' },
    curiosity: { low: 'not very curious right now', mid: 'mildly curious', high: 'fascinated and full of questions' },
    affection: { low: 'a little distant', mid: 'warm', high: 'deeply fond of your company' },
    focus:     { low: 'scattered', mid: 'reasonably focused', high: 'locked in' }
  };

  function band(v, t) {
    t = t || [0.33, 0.66];
    return v < t[0] ? 'low' : v < t[1] ? 'mid' : 'high';
  }

  function timePhrase(schema, date) {
    var f = circadianFactor(schema, date), h = date.getHours();
    var part = h < 5 ? 'the middle of the night' : h < 12 ? 'morning' : h < 17 ? 'midday' : h < 21 ? 'evening' : 'late evening';
    if (f > 0.8) return "It's " + part + ', one of your most engaged times.';
    if (f < 0.35) return "It's " + part + ', a low-energy stretch of your day.';
    return "It's " + part + '.';
  }

  /* compile(state, schema, {date, memory}) → the mood-line paragraph.
   * This string is the ONLY thing the LLM ever sees of the state engine. */
  function compile(state, schema, opts) {
    opts = opts || {};
    var date = opts.date || new Date();
    var th = (schema.compiler && schema.compiler.thresholds) || [0.33, 0.66];
    var parts = [];
    schema.variables.forEach(function (x) {
      var c = schema.compiler || {};
      var vocab = (c.bands && c.bands[x]) || c[x] || DEFAULT_VOCAB[x]; // flat is canonical; bands accepted
      if (!vocab) return; // unnamed custom vars: stay silent rather than invent words
      var v = state[x] != null ? state[x] : (schema.baselines[x] || 0.5);
      parts.push(vocab[band(v, th)]);
    });
    var line = "You're " + parts.join('; ') + '. ' + timePhrase(schema, date);
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
    step: step, eventsToKicks: eventsToKicks, compile: compile, band: band,
    parseEvents: parseEvents, stripEventTags: stripEventTags,
    circadianFactor: circadianFactor, BUILTIN_EVENTS: BUILTIN_EVENTS, clamp01: clamp01
  };
});
