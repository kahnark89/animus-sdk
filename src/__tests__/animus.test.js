'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Animus, engine: E } = require('../index');

const SCHEMA = {
  name: 'test-agent',
  variables: ['mood', 'energy', 'curiosity', 'affection', 'focus'],
  baselines: { mood: 0.65, energy: 0.70, curiosity: 0.75, affection: 0.50, focus: 0.60 },
  homeostasis_rate: 0.08,
  coupling: { energy: { mood: 0.30, curiosity: 0.25, focus: 0.20 } },
  circadian: { peaks: ['09:00', '14:00'], floor: 0.15 },
  noise: { magnitude: 0, autocorrelation: 0.7 }
};
const NOON = () => new Date(2026, 5, 11, 12, 0, 0);

test('homeostasis converges to baseline', () => {
  let s = { state: { mood: 0.10, energy: 0.70, curiosity: 0.75, affection: 0.50, focus: 0.60 }, noiseState: {} };
  for (let i = 0; i < 300; i++) s = E.step(s.state, SCHEMA, { date: NOON(), noiseState: s.noiseState });
  assert.ok(Math.abs(s.state.mood - 0.65) < 0.02, `mood ${s.state.mood} should approach 0.65`);
});

test('state is clamped to [0,1] under extreme events', () => {
  const kicks = E.eventsToKicks([{ type: 'reunion', intensity: 50 }], SCHEMA);
  const s = E.step({ mood: 0.9, energy: 0.9, curiosity: 0.5, affection: 0.9, focus: 0.5 }, SCHEMA, { date: NOON(), kicks });
  assert.ok(s.state.affection <= 1 && s.state.mood <= 1);
});

test('coupling: low energy drags mood below baseline', () => {
  let s = { state: { mood: 0.65, energy: 0.10, curiosity: 0.75, affection: 0.50, focus: 0.60 }, noiseState: {} };
  s = E.step(s.state, SCHEMA, { date: NOON(), noiseState: s.noiseState });
  assert.ok(s.state.mood < 0.65, `mood ${s.state.mood} should dip when energy is far below baseline`);
});

test('circadian factor respects floor and peaks', () => {
  const atPeak = E.circadianFactor(SCHEMA, new Date(2026, 5, 11, 9, 0));
  const at3am = E.circadianFactor(SCHEMA, new Date(2026, 5, 11, 3, 0));
  assert.ok(atPeak > 0.95);
  assert.ok(at3am >= 0.15 && at3am < 0.4);
});

test('event kicks scale with intensity and support custom schema events', () => {
  const schema = Object.assign({}, SCHEMA, { events: { breakthrough: { mood: 0.25, energy: 0.15 } } });
  const k = E.eventsToKicks([{ type: 'breakthrough', intensity: 0.5 }], schema);
  assert.ok(Math.abs(k.mood - 0.125) < 1e-9);
});

test('parseEvents extracts known tags, ignores unknown, intensity defaults to 1', () => {
  const text = 'That worked! [[delight:0.8]] also [[made_up_event:1.0]] and [[fatigue]]';
  const ev = E.parseEvents(text, SCHEMA);
  assert.deepStrictEqual(ev, [{ type: 'delight', intensity: 0.8 }, { type: 'fatigue', intensity: 1 }]);
  assert.strictEqual(E.stripEventTags(text), 'That worked! also and');
});

test('compile produces banded vocab and custom compiler words', () => {
  const schema = Object.assign({}, SCHEMA, { compiler: { mood: { low: 'gray', mid: 'even', high: 'glowing' } } });
  const line = E.compile({ mood: 0.9, energy: 0.7, curiosity: 0.7, affection: 0.5, focus: 0.6 }, schema, { date: NOON() });
  assert.ok(line.includes('glowing'), line);
  assert.ok(line.includes('midday'), line);
});

test('persistence: state and memories survive a process boundary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'animus-'));
  const db = path.join(dir, 'agent.memory.db');
  const a = new Animus({ schema: SCHEMA, memory: db, now: NOON, rng: () => 0.5 });
  a.apply([{ type: 'reunion', intensity: 1 }]);
  a.remember('the auth module', 0.9);
  const affectionAfter = a.state().affection;
  assert.ok(affectionAfter > 0.5);

  const b = new Animus({ schema: SCHEMA, memory: db, now: NOON, rng: () => 0.5 });
  assert.ok(Math.abs(b.state().affection - affectionAfter) < 1e-9, 'state reloads exactly');
  assert.strictEqual(b.topMemory(), 'the auth module');
  assert.ok(b.compile().includes('the auth module'));
});

test('tick advances by wall-clock time and is capped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'animus-'));
  const db = path.join(dir, 'agent.memory.db');
  let t = new Date(2026, 5, 11, 12, 0, 0);
  const a = new Animus({ schema: SCHEMA, memory: db, now: () => t, rng: () => 0.5 });
  a.apply([{ type: 'fatigue', intensity: 1 }]);     // energy knocked down
  const low = a.state().energy;
  t = new Date(2026, 5, 11, 14, 0, 0);              // two hours pass (peak time)
  a.tick();
  assert.ok(a.state().energy > low, 'energy recovers toward circadian baseline over elapsed time');
  t = new Date(2026, 5, 25, 14, 0, 0);              // two weeks pass
  a.tick();                                          // must not loop 20k steps
  assert.ok(a.state().energy > 0 && a.state().energy <= 1);
});

test('memory salience decays with halflife', () => {
  let t = new Date(2026, 5, 11, 12, 0, 0);
  const a = new Animus({ schema: SCHEMA, now: () => t });
  a.remember('old thing', 0.6);
  t = new Date(2026, 6, 30, 12, 0, 0); // ~7 weeks later
  assert.strictEqual(a.topMemory(), null, 'decayed memories stop surfacing');
});

// ── New feature tests ──────────────────────────────────────────────────────────

test('gist() tracks topics and topMemories() surfaces by frequency', () => {
  const a = new Animus({ schema: SCHEMA });
  a.gist('auth, onboarding');
  a.gist(['auth', 'billing']);   // auth now has count 2
  const top = a.topMemories(3);
  assert.strictEqual(top[0], 'auth', 'highest-frequency topic should lead');
  assert.ok(top.includes('onboarding'), 'single-mention topic should appear');
  assert.ok(top.includes('billing'), 'second single-mention should appear');
});

test('gist() mixes with episodic memories in topMemories()', () => {
  const a = new Animus({ schema: SCHEMA });
  a.remember('the deployment incident', 0.9);
  a.gist('auth');
  const top = a.topMemories(2);
  assert.ok(top.includes('the deployment incident'), 'high-salience memory should surface');
  assert.ok(top.includes('auth'), 'topic should surface alongside episodic memory');
});

test('compile() injects top topics as memory clause', () => {
  const a = new Animus({ schema: SCHEMA, now: NOON });
  a.gist('auth');
  const line = a.compile();
  assert.ok(line.includes('auth'), `compile output should mention auth topic; got: "${line}"`);
});

test('compile() suppresses memory injection when memory_injection is false', () => {
  const schema = Object.assign({}, SCHEMA, { compiler: { memory_injection: false } });
  const a = new Animus({ schema, now: NOON });
  a.gist('auth');
  const line = a.compile();
  assert.ok(!line.includes('thinking about'), 'memory injection disabled — no topic clause');
});

test('event_sensitivity scales event kicks proportionally', () => {
  const s1 = Object.assign({}, SCHEMA);
  const s2 = Object.assign({}, SCHEMA, { event_sensitivity: { delight: 2.0 } });
  const k1 = E.eventsToKicks([{ type: 'delight', intensity: 1 }], s1);
  const k2 = E.eventsToKicks([{ type: 'delight', intensity: 1 }], s2);
  assert.ok(Math.abs(k2.mood / k1.mood - 2.0) < 1e-9, '2× sensitivity → 2× mood kick');
  assert.ok(Math.abs(k2.energy / k1.energy - 2.0) < 1e-9, '2× sensitivity → 2× energy kick');
});

test('event_sensitivity does not affect events not listed', () => {
  const s = Object.assign({}, SCHEMA, { event_sensitivity: { delight: 2.0 } });
  const k1 = E.eventsToKicks([{ type: 'fatigue', intensity: 1 }], SCHEMA);
  const k2 = E.eventsToKicks([{ type: 'fatigue', intensity: 1 }], s);
  assert.ok(Math.abs(k1.energy - k2.energy) < 1e-9, 'unlisted events unaffected by event_sensitivity');
});

test('auto-triggers fire when state condition is met', () => {
  const schema = Object.assign({}, SCHEMA, {
    triggers: [{ condition: 'energy < 0.50', fire: 'fatigue', cooldown_steps: 0 }]
  });
  let t = new Date(2026, 5, 11, 12, 0, 0);
  const a = new Animus({ schema, now: () => t, rng: () => 0.5 });
  // Force energy very low so trigger condition is met on next tick
  a.db.state.energy = 0.30;
  t = new Date(2026, 5, 11, 12, 1, 0); // advance 1 minute to trigger tick
  const energyBefore = a.db.state.energy;
  a.tick();
  // Trigger should have fired fatigue event, pushing energy further down
  assert.ok(a.state().energy < energyBefore + 0.01,
    'auto-trigger fired fatigue which prevents energy recovery above trigger start');
});

test('auto-trigger cooldown prevents re-fire within cooldown window', () => {
  const schema = Object.assign({}, SCHEMA, {
    triggers: [{ condition: 'mood < 0.90', fire: 'delight', cooldown_steps: 1000 }]
  });
  let t = new Date(2026, 5, 11, 12, 0, 0);
  const a = new Animus({ schema, now: () => t, rng: () => 0.5 });
  t = new Date(2026, 5, 11, 12, 1, 0);
  a.tick(); // trigger fires on first tick
  const firedAt = a.db.triggerState[0] && a.db.triggerState[0].lastFiredAt;
  assert.ok(firedAt, 'trigger should have fired on first tick');
  t = new Date(2026, 5, 11, 12, 2, 0);
  a.tick(); // within 1000-step cooldown (only 1 step elapsed)
  // lastFiredAt must not have changed — trigger did not re-fire
  assert.strictEqual(a.db.triggerState[0].lastFiredAt, firedAt, 'trigger must not re-fire within cooldown');
});

test('growth rules permanently shift baselines after N events', () => {
  const schema = { ...SCHEMA, baselines: { ...SCHEMA.baselines },
    growth: { rules: [{ trigger: 'delight_count > 2', shifts: { mood: 0.05 } }] } };
  const a = new Animus({ schema, now: NOON });
  const before = a.schema.baselines.mood; // 0.65
  a.apply([{ type: 'delight' }]);
  a.apply([{ type: 'delight' }]);
  assert.strictEqual(a.schema.baselines.mood, before, 'baseline unchanged before threshold');
  a.apply([{ type: 'delight' }]); // 3rd delight crosses threshold > 2
  assert.ok(Math.abs(a.schema.baselines.mood - (before + 0.05)) < 1e-9,
    `baseline should shift by 0.05; got ${a.schema.baselines.mood}`);
});

test('growth rules fire at most once (idempotent)', () => {
  const schema = { ...SCHEMA, baselines: { ...SCHEMA.baselines },
    growth: { rules: [{ trigger: 'delight_count > 1', shifts: { mood: 0.05 } }] } };
  const a = new Animus({ schema, now: NOON });
  const before = a.schema.baselines.mood;
  a.apply([{ type: 'delight' }]);
  a.apply([{ type: 'delight' }]); // crosses threshold, rule fires
  const shifted = a.schema.baselines.mood;
  a.apply([{ type: 'delight' }]); // already fired — must not fire again
  a.apply([{ type: 'delight' }]);
  assert.ok(Math.abs(a.schema.baselines.mood - shifted) < 1e-9, 'growth rule fires exactly once');
});

test('growth rules and baseline shifts persist across process boundary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'animus-'));
  const dbPath = path.join(dir, 'growth.db');
  const growthRules = { rules: [{ trigger: 'delight_count > 2', shifts: { mood: 0.05 } }] };
  const schema = { ...SCHEMA, baselines: { ...SCHEMA.baselines }, growth: growthRules };
  const a = new Animus({ schema, memory: dbPath, now: NOON });
  a.apply([{ type: 'delight' }]);
  a.apply([{ type: 'delight' }]);
  a.apply([{ type: 'delight' }]); // fires growth
  const shifted = a.schema.baselines.mood;

  const b = new Animus({ schema: { ...SCHEMA, baselines: { ...SCHEMA.baselines }, growth: growthRules },
    memory: dbPath, now: NOON });
  assert.ok(Math.abs(b.schema.baselines.mood - shifted) < 1e-9,
    'growth baseline shift must survive process restart');
  // Rule must not re-fire in new instance
  b.apply([{ type: 'delight' }]);
  assert.ok(Math.abs(b.schema.baselines.mood - shifted) < 1e-9,
    'growth rule must not re-fire after reload');
});

test('Animus.generatePersona() is deterministic', () => {
  const s1 = Animus.generatePersona(12345);
  const s2 = Animus.generatePersona(12345);
  assert.deepStrictEqual(s1.baselines, s2.baselines);
  assert.strictEqual(s1.homeostasis_rate, s2.homeostasis_rate);
  assert.deepStrictEqual(s1.noise, s2.noise);
  assert.strictEqual(s1.persona.voice, s2.persona.voice);
});

test('Animus.generatePersona() different seeds produce different physics', () => {
  const s1 = Animus.generatePersona(1);
  const s2 = Animus.generatePersona(2);
  // At least one physics parameter must differ
  const differ = s1.homeostasis_rate !== s2.homeostasis_rate
    || s1.baselines.mood !== s2.baselines.mood
    || s1.noise.magnitude !== s2.noise.magnitude;
  assert.ok(differ, 'adjacent seeds must produce different physics');
});

test('Animus.generatePersona() all baselines and lambda in valid range', () => {
  for (let seed = 0; seed < 200; seed++) {
    const s = Animus.generatePersona(seed);
    assert.ok(s.baselines.mood >= 0.35 && s.baselines.mood <= 0.80, `seed ${seed} mood OOB`);
    assert.ok(s.baselines.energy >= 0.35 && s.baselines.energy <= 0.85, `seed ${seed} energy OOB`);
    assert.ok(s.homeostasis_rate >= 0.03 && s.homeostasis_rate <= 0.18, `seed ${seed} lambda OOB`);
    assert.ok(s.noise.magnitude >= 0.008 && s.noise.magnitude <= 0.045, `seed ${seed} noise OOB`);
  }
});

test('constructor persona.seed auto-applies generated physics', () => {
  const base = { variables: ['mood', 'energy', 'curiosity', 'affection', 'focus'],
    baselines: { mood: 0.5, energy: 0.5, curiosity: 0.5, affection: 0.5, focus: 0.5 },
    persona: { seed: 42 } };
  const a = new Animus({ schema: base });
  const ref = Animus.generatePersona(42, base);
  assert.strictEqual(a.schema.homeostasis_rate, ref.homeostasis_rate);
  assert.deepStrictEqual(a.schema.noise, ref.noise);
  assert.deepStrictEqual(a.schema.coupling, ref.coupling);
  assert.strictEqual(a.schema.persona.voice, ref.persona.voice);
});

test('cleanText() strips event tags from LLM output', () => {
  const a = new Animus({ schema: SCHEMA });
  assert.strictEqual(a.cleanText('Hello [[delight:0.8]] world [[fatigue]]'), 'Hello world');
  assert.strictEqual(a.cleanText('No tags here'), 'No tags here');
  assert.strictEqual(a.cleanText(''), '');
});

test('compile() trend clause: "Lifting." appears when lead var is rising', () => {
  const a = new Animus({ schema: SCHEMA, now: NOON });
  // First compile establishes snapshot
  a.compile();
  // Drive mood up artificially
  a.db.state.mood = 0.95;
  a._prevCompileState = { mood: 0.50, energy: 0.70, curiosity: 0.75, affection: 0.50, focus: 0.60 };
  const line = a.compile();
  assert.ok(line.includes('Lifting.'), `expected trend clause "Lifting." in: "${line}"`);
});

test('compile() trend clause: "Still sliding." appears when lead var is falling', () => {
  const a = new Animus({ schema: SCHEMA, now: NOON });
  a.compile();
  a.db.state.mood = 0.20;
  a._prevCompileState = { mood: 0.65, energy: 0.70, curiosity: 0.75, affection: 0.50, focus: 0.60 };
  const line = a.compile();
  assert.ok(line.includes('Still sliding.'), `expected trend clause in: "${line}"`);
});
