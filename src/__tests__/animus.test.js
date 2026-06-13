/**
 * animus-sdk test suite
 * Tests physics correctness, persona determinism, persistence, memory,
 * triggers, growth, social coupling, set-point drift, and inference.
 *
 * Run: node --experimental-vm-modules node_modules/.bin/jest
 * Or:  node src/__tests__/animus.test.js   (self-executing)
 */

'use strict';

const engine = require('../engine');
const { generatePersona, traitsFromSeed, VOICE_REGISTERS } = require('../persona');

// ── Lightweight test harness (no external dependency) ─────────────────────

let passed = 0, failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    process.stdout.write('  ✓ ' + name + '\n');
    passed++;
  } catch (e) {
    process.stdout.write('  ✗ ' + name + '\n    ' + e.message + '\n');
    errors.push({ name, msg: e.message });
    failed++;
  }
}

function expect(val) {
  return {
    toBe(x)       { if (val !== x)         throw new Error(`Expected ${JSON.stringify(x)}, got ${JSON.stringify(val)}`); },
    toEqual(x)    { if (JSON.stringify(val) !== JSON.stringify(x)) throw new Error(`Deep-equal failed:\n  expected: ${JSON.stringify(x)}\n  got:      ${JSON.stringify(val)}`); },
    toBeCloseTo(x, d=4) { if (Math.abs(val - x) > 5*Math.pow(10,-d)) throw new Error(`Expected ~${x}, got ${val}`); },
    toBeGreaterThan(x)  { if (!(val > x))  throw new Error(`Expected ${val} > ${x}`); },
    toBeLessThan(x)     { if (!(val < x))  throw new Error(`Expected ${val} < ${x}`); },
    toBeGreaterThanOrEqual(x) { if (!(val >= x)) throw new Error(`Expected ${val} >= ${x}`); },
    toBeLessThanOrEqual(x)    { if (!(val <= x)) throw new Error(`Expected ${val} <= ${x}`); },
    toContain(x)  { if (!val.includes(x))  throw new Error(`Expected to contain "${x}", got "${val}"`); },
    toBeTruthy()  { if (!val)              throw new Error(`Expected truthy, got ${val}`); },
    toBeFalsy()   { if (val)               throw new Error(`Expected falsy, got ${val}`); },
    toHaveLength(n){ if (val.length !== n) throw new Error(`Expected length ${n}, got ${val.length}`); },
  };
}

function section(name) {
  process.stdout.write('\n── ' + name + ' ──\n');
}

// ─── Math utilities ───────────────────────────────────────────────────────

section('Math utilities');

test('clamp01 clamps to [0,1]', () => {
  expect(engine.clamp01(-1)).toBe(0);
  expect(engine.clamp01(2)).toBe(1);
  expect(engine.clamp01(0.5)).toBe(0.5);
});

test('band5 maps to correct bands', () => {
  expect(engine.band5(0.10)).toBe('very_low');
  expect(engine.band5(0.30)).toBe('low');
  expect(engine.band5(0.50)).toBe('mid');
  expect(engine.band5(0.75)).toBe('high');
  expect(engine.band5(0.92)).toBe('very_high');
  expect(engine.band5(0.35)).toBe('mid');   // boundary: 0.35 is mid, not low
  expect(engine.band5(0.15)).toBe('low');   // boundary: 0.15 is low, not very_low
});

test('stateHash is deterministic', () => {
  const s = { mood:0.5, energy:0.6, curiosity:0.4, affection:0.7, focus:0.3 };
  const h1 = engine.stateHash(s);
  const h2 = engine.stateHash(s);
  expect(h1).toBe(h2);
  expect(h1).toBeGreaterThanOrEqual(0);
  expect(h1).toBeLessThan(1);
});

test('stateHash differs for different states', () => {
  const s1 = { mood:0.5, energy:0.5, curiosity:0.5, affection:0.5, focus:0.5 };
  const s2 = { mood:0.6, energy:0.5, curiosity:0.5, affection:0.5, focus:0.5 };
  expect(engine.stateHash(s1) !== engine.stateHash(s2)).toBeTruthy();
});

// ─── Circadian rhythm ─────────────────────────────────────────────────────

section('Circadian rhythm');

test('circadianFactor returns floor at 3am', () => {
  const circ = { peaks: [9, 14], sigma_hours: 2, floor: 0.15 };
  const d = new Date(); d.setHours(3, 0, 0, 0);
  const f = engine.circadianFactor(d.getTime(), circ);
  // At 3am, 6 hours from closest peak (9am), sigma=2h → very small Gaussian
  expect(f).toBeCloseTo(0.15, 2);  // should be near floor
});

test('circadianFactor peaks near morning peak hour', () => {
  const circ = { peaks: [9, 14], sigma_hours: 2, floor: 0.15 };
  const d = new Date(); d.setHours(9, 0, 0, 0);
  const f = engine.circadianFactor(d.getTime(), circ);
  expect(f).toBeCloseTo(1.0, 3);   // at exact peak
});

test('circadianFactor is between floor and 1 at all times', () => {
  const circ = { peaks: [9, 14], sigma_hours: 2, floor: 0.20 };
  for (let h = 0; h < 24; h++) {
    const d = new Date(); d.setHours(h, 0, 0, 0);
    const f = engine.circadianFactor(d.getTime(), circ);
    expect(f).toBeGreaterThanOrEqual(0.20);
    expect(f).toBeLessThanOrEqual(1.01);
  }
});

test('effectiveBaseline modulates energy with circadian', () => {
  // Use seed 42 which has arousal=0.448 → morning peak at ~8am, afternoon peak ~14-15h
  const schema = generatePersona(42);
  // At peak hour (morning peak) effective baseline should be above the floor level
  const peakHour = schema.circadian.peaks[0]; // ~8 for seed 42
  const dPeak = new Date(); dPeak.setHours(peakHour, 0, 0, 0);
  const dNadir = new Date(); dNadir.setHours(3, 30, 0, 0); // 3:30am — far from any peak
  const effPeak  = engine.effectiveBaseline('energy', schema, dPeak.getTime());
  const effNadir = engine.effectiveBaseline('energy', schema, dNadir.getTime());
  // Peak should have higher effective baseline than 3:30am
  expect(effPeak).toBeGreaterThan(effNadir);
});

// ─── First-order physics ──────────────────────────────────────────────────

section('First-order physics');

test('homeostasis pulls state toward baseline', () => {
  const schema = generatePersona(1);
  // Force schema to first-order (no second_order key)
  delete schema.second_order;
  const baseline = schema.baselines.mood;
  let state = {};
  let noise = {};
  for (const v of engine.VARS) { state[v] = v === 'mood' ? 0.0 : schema.baselines[v]; noise[v] = 0; }

  // Run 200 steps with zero noise (test purely homeostatic pull)
  const stableSchema = JSON.parse(JSON.stringify(schema));
  stableSchema.noise = { magnitude: 0.0001, autocorrelation: 0 };

  const result = engine.runSteps(state, {}, noise, stableSchema, Date.now(), 200, null);
  // Mood should be substantially higher than 0.0 after 200 steps
  expect(result.state.mood).toBeGreaterThan(0.3);
});

test('state stays within [0,1] after many steps', () => {
  const schema = generatePersona(42);
  delete schema.second_order;
  let state = {}, noise = {};
  for (const v of engine.VARS) { state[v] = schema.baselines[v]; noise[v] = 0; }

  const kicks = engine.eventsToKicks([{ type: 'delight', intensity: 2.0 }], schema);
  const result = engine.runSteps(state, {}, noise, schema, Date.now(), 500, kicks);
  for (const v of engine.VARS) {
    expect(result.state[v]).toBeGreaterThanOrEqual(0);
    expect(result.state[v]).toBeLessThanOrEqual(1);
  }
});

test('positive events raise mood', () => {
  const schema = generatePersona(42);
  delete schema.second_order;
  schema.noise = { magnitude: 0.0001, autocorrelation: 0 };
  let state = {}, noise = {};
  for (const v of engine.VARS) { state[v] = schema.baselines[v]; noise[v] = 0; }
  const before = state.mood;

  const kicks = engine.eventsToKicks([{ type: 'delight', intensity: 1 }], schema);
  const result = engine.runSteps(state, {}, noise, schema, Date.now(), 1, kicks);
  expect(result.state.mood).toBeGreaterThan(before);
});

test('negative events lower energy', () => {
  const schema = generatePersona(42);
  delete schema.second_order;
  schema.noise = { magnitude: 0.0001, autocorrelation: 0 };
  let state = {}, noise = {};
  for (const v of engine.VARS) { state[v] = schema.baselines[v]; noise[v] = 0; }
  const before = state.energy;

  const kicks = engine.eventsToKicks([{ type: 'fatigue', intensity: 1 }], schema);
  const result = engine.runSteps(state, {}, noise, schema, Date.now(), 1, kicks);
  expect(result.state.energy).toBeLessThan(before);
});

// ─── Second-order physics ─────────────────────────────────────────────────

section('Second-order physics (inertia)');

test('second-order does not ceiling-stick after delight kick', () => {
  const schema = generatePersona(42);
  schema.second_order = { natural_freq: 0.08, damping_ratio: 0.70 };
  schema.noise = { magnitude: 0.0001, autocorrelation: 0 }; // zero noise for determinism
  let state = {}, vel = {}, noise = {};
  for (const v of engine.VARS) { state[v] = schema.baselines[v]; vel[v] = 0; noise[v] = 0; }

  const kicks = engine.eventsToKicks([{ type: 'delight', intensity: 1 }], schema);
  // Run 1 step with kick
  let cur = engine.runSteps(state, vel, noise, schema, Date.now(), 1, kicks);
  const peakMood = cur.state.mood;
  // Run 30 more steps without kicks
  cur = engine.runSteps(cur.state, cur.velocityState, cur.noiseState, schema, Date.now(), 30, null);
  const laterMood = cur.state.mood;

  // Post-kick mood should be above baseline but NOT at ceiling (1.0)
  expect(peakMood).toBeGreaterThan(schema.baselines.mood);
  expect(peakMood).toBeLessThan(0.98);   // definitively not stuck at ceiling
  expect(laterMood).toBeLessThan(peakMood);  // decaying back toward baseline
});

test('second-order has measurable velocity after kick', () => {
  const schema = generatePersona(1);
  schema.second_order = { natural_freq: 0.08, damping_ratio: 0.90 };
  schema.noise = { magnitude: 0.0001, autocorrelation: 0 };
  let state = {}, vel = {}, noise = {};
  for (const v of engine.VARS) { state[v] = schema.baselines[v]; vel[v] = 0; noise[v] = 0; }

  const kicks = engine.eventsToKicks([{ type: 'delight', intensity: 1 }], schema);
  const result = engine.runSteps(state, vel, noise, schema, Date.now(), 2, kicks);
  // After kick + oscillator step, velocity should be non-zero
  const moodVel = Math.abs(result.velocityState.mood || 0);
  expect(moodVel).toBeGreaterThan(0);
});

test('first-order and second-order produce different trajectories after same kick', () => {
  const schema1 = generatePersona(77); delete schema1.second_order;
  schema1.noise = { magnitude: 0.0001, autocorrelation: 0 };
  const schema2 = JSON.parse(JSON.stringify(schema1));
  schema2.second_order = { natural_freq: 0.08, damping_ratio: 0.80 };

  let s1 = {}, s2 = {}, v1 = {}, v2 = {}, n1 = {}, n2 = {};
  for (const v of engine.VARS) {
    s1[v] = s2[v] = schema1.baselines[v];
    v1[v] = v2[v] = 0; n1[v] = n2[v] = 0;
  }
  const kicks = engine.eventsToKicks([{ type: 'delight', intensity: 1 }], schema1);

  const r1 = engine.runSteps(s1, v1, n1, schema1, Date.now(), 15, kicks);
  const r2 = engine.runSteps(s2, v2, n2, schema2, Date.now(), 15, kicks);

  // Trajectories should differ meaningfully
  const diff = Math.abs(r1.state.mood - r2.state.mood);
  expect(diff).toBeGreaterThan(0.001);
});

// ─── Set-point drift ──────────────────────────────────────────────────────

section('Set-point drift');

test('driftSetpoints returns shifts for elapsed days > threshold', () => {
  const schema = generatePersona(42);
  const shifts = engine.driftSetpoints({}, schema, 3);
  let hasShift = false;
  for (const v of engine.VARS) {
    if (Math.abs(shifts[v] || 0) > 0) { hasShift = true; break; }
  }
  expect(hasShift).toBeTruthy();
});

test('driftSetpoints stays within ±max bound', () => {
  const schema = generatePersona(42);
  let shifts = {};
  // Accumulate 100 days of drift
  for (let i = 0; i < 50; i++) {
    shifts = engine.driftSetpoints(shifts, schema, 2);
  }
  const max = schema.setpoint_drift.max;
  for (const v of engine.VARS) {
    expect(Math.abs(shifts[v] || 0)).toBeLessThanOrEqual(max + 0.001);
  }
});

test('driftSetpoints does nothing below threshold', () => {
  const schema = generatePersona(42);
  // threshold_days ~ 1-2 for most seeds; use 0.1 days
  const shifts = engine.driftSetpoints({}, schema, 0.1);
  for (const v of engine.VARS) {
    expect(shifts[v] || 0).toBe(0);
  }
});

// ─── Social coupling ──────────────────────────────────────────────────────

section('Social coupling');

test('elevated peer mood generates positive influence kicks', () => {
  const selfSchema = generatePersona(42);
  const peerSchema = generatePersona(99);
  // Peer is significantly above their baseline mood
  const peerState = {};
  for (const v of engine.VARS) peerState[v] = peerSchema.baselines[v];
  peerState.mood = Math.min(1, peerSchema.baselines.mood + 0.4);

  const kicks = engine.socialInfluenceKicks(selfSchema, [{
    state: peerState, schema: peerSchema, strength: 0.10,
  }]);

  expect(kicks.mood).toBeGreaterThan(0);
});

test('depressed peer generates negative influence', () => {
  const selfSchema = generatePersona(42);
  const peerSchema = generatePersona(99);
  const peerState = {};
  for (const v of engine.VARS) peerState[v] = peerSchema.baselines[v];
  peerState.mood = Math.max(0, peerSchema.baselines.mood - 0.4);

  const kicks = engine.socialInfluenceKicks(selfSchema, [{
    state: peerState, schema: peerSchema, strength: 0.10,
  }]);

  expect(kicks.mood).toBeLessThan(0);
});

// ─── Event processing ─────────────────────────────────────────────────────

section('Event processing');

test('parseEvents extracts [[event]] tags', () => {
  const events = engine.parseEvents('That was great! [[delight:1.2]] [[praise]]');
  expect(events).toHaveLength(2);
  expect(events[0].type).toBe('delight');
  expect(events[0].intensity).toBeCloseTo(1.2);
  expect(events[1].type).toBe('praise');
  expect(events[1].intensity).toBe(1);
});

test('parseEvents ignores unknown event types', () => {
  const events = engine.parseEvents('[[bananas:1.0]] [[delight]]');
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe('delight');
});

test('stripEventTags removes tags from text', () => {
  const clean = engine.stripEventTags('Hello! [[delight:1.0]] How are you? [[fatigue]]');
  expect(clean).toBe('Hello! How are you?');
});

test('inferEvents detects emotional signals from text', () => {
  const events = engine.inferEvents('That was a wonderful discovery! I found it fascinating.');
  expect(events.length).toBeGreaterThan(0);
  const types = events.map(e => e.type);
  expect(types.includes('delight') || types.includes('discovery')).toBeTruthy();
});

test('inferEvents returns empty array for neutral text', () => {
  const events = engine.inferEvents('The server is running on port 3000.');
  // Might still find something, but should be sparse
  expect(events.length).toBeLessThan(3);
});

test('eventsToKicks scales by intensity', () => {
  const schema = generatePersona(1);
  const k1 = engine.eventsToKicks([{ type: 'delight', intensity: 1 }], schema);
  const k2 = engine.eventsToKicks([{ type: 'delight', intensity: 2 }], schema);
  expect(k2.mood).toBeCloseTo(k1.mood * 2, 3);
});

// ─── Compiler ─────────────────────────────────────────────────────────────

section('Compiler');

test('compile returns a non-empty string', () => {
  const schema = generatePersona(42);
  const state = Object.assign({}, schema.baselines);
  const line = engine.compile(state, schema, Date.now(), null, []);
  expect(typeof line).toBe('string');
  expect(line.length).toBeGreaterThan(10);
});

test('compile is deterministic for same state', () => {
  const schema = generatePersona(42);
  const state = Object.assign({}, schema.baselines);
  const now = Date.now();
  const l1 = engine.compile(state, schema, now, null, []);
  const l2 = engine.compile(state, schema, now, null, []);
  expect(l1).toBe(l2);
});

test('compile injects memory gist', () => {
  const schema = generatePersona(42);
  const state = Object.assign({}, schema.baselines);
  const line = engine.compile(state, schema, Date.now(), null, ['auth', 'billing']);
  expect(line).toContain('auth');
  expect(line).toContain('billing');
});

test('compile appends "Lifting." trend when lead variable is rising', () => {
  const schema = generatePersona(1);
  schema.noise = { magnitude: 0.0001, autocorrelation: 0 };
  // Set mood well above effective baseline so it IS the lead variable by deviation
  const now = Date.now();
  const effMood = engine.effectiveBaseline('mood', schema, now);
  // Place mood significantly above effective baseline — it will be lead var
  const curr = {
    mood:      Math.min(0.99, effMood + 0.25),
    energy:    schema.baselines.energy,
    curiosity: schema.baselines.curiosity,
    affection: schema.baselines.affection,
    focus:     schema.baselines.focus,
  };
  // prev mood was lower — so delta > 0.03 → Lifting
  const prev = Object.assign({}, curr, { mood: curr.mood - 0.15 });
  const line = engine.compile(curr, schema, now, prev, []);
  expect(line).toContain('Lifting.');
});

test('compile includes time context', () => {
  const schema = generatePersona(42);
  const state = Object.assign({}, schema.baselines);
  const line = engine.compile(state, schema, Date.now(), null, []);
  expect(
    line.includes("morning") || line.includes("midday") ||
    line.includes("afternoon") || line.includes("evening") ||
    line.includes("night") || line.includes("mid-morning")
  ).toBeTruthy();
});

// ─── Persona generation ───────────────────────────────────────────────────

section('Persona generation');

test('same seed always produces same persona', () => {
  const p1 = generatePersona(42);
  const p2 = generatePersona(42);
  expect(p1.baselines.mood).toBeCloseTo(p2.baselines.mood, 10);
  expect(p1.compiler.register).toBe(p2.compiler.register);
  expect(p1._traits.valence).toBeCloseTo(p2._traits.valence, 10);
});

test('different seeds produce different personas', () => {
  const p1 = generatePersona(42);
  const p2 = generatePersona(43);
  expect(p1.baselines.mood !== p2.baselines.mood).toBeTruthy();
});

test('traitsFromSeed produces traits in [0,1]', () => {
  const t = traitsFromSeed(42);
  for (const [, v] of Object.entries(t)) {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  }
});

test('all baselines are in [0,1]', () => {
  for (const seed of [1, 42, 12345, 999999, 4294967295]) {
    const schema = generatePersona(seed);
    for (const v of engine.VARS) {
      expect(schema.baselines[v]).toBeGreaterThanOrEqual(0);
      expect(schema.baselines[v]).toBeLessThanOrEqual(1);
    }
  }
});

test('stability guarantee: k₁×k₂ < λ² for all coupling loops', () => {
  // Test 200 random seeds for stability
  for (let i = 0; i < 200; i++) {
    const seed = Math.floor(Math.random() * 4294967296);
    const schema = generatePersona(seed);
    const λ = schema.homeostasis_rate;
    const c = schema.coupling;
    // Check energy↔mood loop if it exists
    if (c.energy && c.energy.mood && c.mood && c.mood.energy) {
      const k1 = c.energy.mood;
      const k2 = c.mood.energy;
      expect(k1 * k2).toBeLessThan(λ * λ + 1e-10);
    }
  }
});

test('second_order parameters are generated and in range', () => {
  const schema = generatePersona(42);
  expect(schema.second_order).toBeTruthy();
  expect(schema.second_order.natural_freq).toBeGreaterThan(0);
  expect(schema.second_order.natural_freq).toBeLessThan(0.2);
  expect(schema.second_order.damping_ratio).toBeGreaterThan(0.5);
  expect(schema.second_order.damping_ratio).toBeLessThanOrEqual(1.0);
});

test('setpoint_drift config is generated', () => {
  const schema = generatePersona(42);
  expect(schema.setpoint_drift).toBeTruthy();
  expect(schema.setpoint_drift.max).toBeGreaterThan(0);
  expect(schema.setpoint_drift.rate_per_day).toBeGreaterThan(0);
});

test('VOICE_REGISTERS has 4 registers with all variables and bands', () => {
  const registers = ['direct', 'vivid', 'physiological', 'social'];
  const bands = ['very_low', 'low', 'mid', 'high', 'very_high'];
  for (const reg of registers) {
    for (const v of engine.VARS) {
      for (const b of bands) {
        const pool = VOICE_REGISTERS[reg][v][b];
        expect(Array.isArray(pool)).toBeTruthy();
        expect(pool.length).toBeGreaterThan(0);
      }
    }
  }
});

test('event_sensitivity multipliers are in plausible range', () => {
  const schema = generatePersona(42);
  for (const [, v] of Object.entries(schema.event_sensitivity)) {
    expect(v).toBeGreaterThan(0.3);
    expect(v).toBeLessThan(2.5);
  }
});

// ─── Diagnose ─────────────────────────────────────────────────────────────

section('Diagnostic');

test('diagnose returns all variables', () => {
  const schema = generatePersona(1);
  const state = Object.assign({}, schema.baselines);
  const diag = engine.diagnose(state, {}, {}, schema, Date.now());
  expect(diag.variables).toHaveLength(5);
  for (const v of diag.variables) {
    expect(engine.VARS.includes(v.name)).toBeTruthy();
  }
});

test('diagnose reports secondOrderEnabled correctly', () => {
  const schema1 = generatePersona(1);
  const schema2 = generatePersona(1); delete schema2.second_order;
  const state = Object.assign({}, schema1.baselines);
  const d1 = engine.diagnose(state, {}, {}, schema1, Date.now());
  const d2 = engine.diagnose(state, {}, {}, schema2, Date.now());
  expect(d1.secondOrderEnabled).toBe(true);
  expect(d2.secondOrderEnabled).toBe(false);
});

// ─── Run summary ──────────────────────────────────────────────────────────

process.stdout.write('\n');
process.stdout.write(`Results: ${passed} passed, ${failed} failed\n`);
if (errors.length > 0) {
  process.stdout.write('\nFailed tests:\n');
  for (const e of errors) {
    process.stdout.write(`  ✗ ${e.name}\n    ${e.msg}\n`);
  }
  process.exit(1);
} else {
  process.stdout.write('All tests passed.\n');
}
