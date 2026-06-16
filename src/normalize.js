/**
 * animus-sdk/src/normalize.js
 * Schema normalization + validation.
 *
 * Brings hand-authored schemas up to exactly what engine.js expects, and
 * fails LOUDLY (not silently) on the things it cannot safely fix. This is the
 * layer that lets the documented, human-friendly schema shape actually run:
 *   - defaults circadian.applies_to            (engine requires it)
 *   - coerces "HH:MM" circadian peaks → hours  (engine does arithmetic on them)
 *   - converts the flat {low,mid,high} compiler form → internal band arrays
 *   - warns about triggers that fire a non-existent event (silent no-ops)
 *
 * Set ANIMUS_SILENT=1 to suppress non-fatal warnings.
 *
 * @license MIT
 */

'use strict';

const VARS = ['mood', 'energy', 'curiosity', 'affection', 'focus'];

// Keep in sync with KICK_TABLE in engine.js.
const BUILTIN_EVENTS = new Set([
  'delight', 'reunion', 'praise', 'discovery', 'play', 'comfort', 'distress',
  'conflict', 'fatigue', 'rejection', 'boredom', 'frustration', 'confusion',
  'surprise', 'challenge', 'absence',
]);

/** Accept an hour number (0–23) or an "HH:MM" / "H:MM" string → fractional hour. */
function parsePeak(p) {
  if (typeof p === 'number') return p;
  if (typeof p === 'string') {
    const m = p.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return (+m[1]) + (+m[2]) / 60;
    const n = Number(p);
    if (!Number.isNaN(n)) return n;
  }
  throw new Error(`Animus schema: circadian.peaks entry ${JSON.stringify(p)} must be an hour number 0-23 or an "HH:MM" string.`);
}

/**
 * The engine reads compiler.bands as { var: { very_low..very_high: string[] } }.
 * The documented human form is flat: compiler.var = { low, mid, high } (strings).
 * Convert the flat form into the internal form; pass the internal form through.
 */
function normalizeCompilerBands(compiler) {
  if (!compiler) return undefined;
  if (compiler.bands) return compiler; // already internal form

  const flatVars = VARS.filter(v => compiler[v] && typeof compiler[v] === 'object');
  if (flatVars.length === 0) return compiler; // nothing to convert

  const bands = {};
  for (const v of flatVars) {
    const { low = '', mid = '', high = '' } = compiler[v];
    bands[v] = {
      very_low:  [low],
      low:       [low],
      mid:       [mid],
      high:      [high],
      very_high: [high],
    };
  }
  return Object.assign({}, compiler, { bands });
}

/**
 * Return a normalized deep copy of the schema. Never mutates the input.
 * Idempotent: normalizing an already-normalized schema is a no-op.
 */
function normalizeSchema(schema) {
  const s = JSON.parse(JSON.stringify(schema));

  if (s.circadian) {
    s.circadian.applies_to = s.circadian.applies_to || ['energy'];
    if (Array.isArray(s.circadian.peaks)) {
      s.circadian.peaks = s.circadian.peaks.map(parsePeak);
    }
  }

  if (s.compiler) {
    s.compiler = normalizeCompilerBands(s.compiler);
  }

  return s;
}

/**
 * Throw on structural problems with an actionable message; warn (once) on
 * soft problems like a trigger firing an event that maps to no kick.
 * Returns the schema unchanged so it composes: validateSchema(normalizeSchema(x)).
 */
function validateSchema(schema) {
  const errs = [];
  const warns = [];

  if (!schema.baselines || typeof schema.baselines !== 'object') {
    errs.push('baselines is required (an object mapping each variable to a number in [0,1]).');
  } else {
    for (const v of VARS) {
      const b = schema.baselines[v];
      if (b == null) errs.push(`baselines.${v} is required (number in [0,1]).`);
      else if (typeof b !== 'number' || b < 0 || b > 1) errs.push(`baselines.${v}=${JSON.stringify(b)} is out of range [0,1].`);
    }
  }

  if (typeof schema.homeostasis_rate !== 'number') {
    errs.push('homeostasis_rate (λ) is required — a number, ~0.08 for a natural feel.');
  }

  if (schema.circadian && schema.circadian.floor != null) {
    const fl = schema.circadian.floor;
    if (typeof fl !== 'number' || fl < 0 || fl > 1) errs.push(`circadian.floor=${JSON.stringify(fl)} must be a number in [0,1].`);
  }

  // Triggers / growth firing an unknown event are silent no-ops at runtime — surface them.
  const knownEvents = new Set([...BUILTIN_EVENTS, ...Object.keys(schema.events || {})]);
  for (const t of schema.triggers || []) {
    if (t && t.fire && !knownEvents.has(t.fire)) {
      warns.push(`trigger condition "${t.condition}" fires "${t.fire}", which is neither a built-in event nor a key in schema.events — it will apply no kick. Did you mean one of: ${[...BUILTIN_EVENTS].slice(0, 6).join(', ')}…?`);
    }
  }

  if (errs.length) {
    throw new Error('Invalid Animus schema:\n  - ' + errs.join('\n  - '));
  }
  if (warns.length && !process.env.ANIMUS_SILENT) {
    for (const w of warns) console.warn('[animus] ' + w);
  }
  return schema;
}

module.exports = { normalizeSchema, validateSchema, parsePeak, normalizeCompilerBands, BUILTIN_EVENTS, VARS };
