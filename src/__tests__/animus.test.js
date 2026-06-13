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
