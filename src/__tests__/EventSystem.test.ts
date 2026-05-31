import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventSystem, AnimusEvent, BUILTIN_EVENTS } from '../EventSystem';
import { AgentSchema } from '../StateEngine';

const SCHEMA: AgentSchema = {
  name: 'test',
  variables: ['mood', 'energy', 'curiosity'],
  baselines: { mood: 0.65, energy: 0.70, curiosity: 0.75 },
  homeostasis_rate: 0.08,
  events: {
    custom_cheer: { mood: 0.20, energy: 0.10 },
  },
};

function makeES(overrides: Partial<AgentSchema> = {}): EventSystem {
  return new EventSystem({ ...SCHEMA, ...overrides });
}

test('parseFromText: parses [EVENT:delight] with default intensity 1.0', () => {
  const es = makeES();
  const events = es.parseFromText('Great job! [EVENT:delight] Keep it up.');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'delight');
  assert.strictEqual(events[0].intensity, 1.0);
});

test('parseFromText: parses [EVENT:confusion:0.3] with explicit intensity', () => {
  const es = makeES();
  const events = es.parseFromText('[EVENT:confusion:0.3]');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'confusion');
  assert.ok(Math.abs(events[0].intensity - 0.3) < 0.001);
});

test('parseFromText: parses multiple events in one string', () => {
  const es = makeES();
  const events = es.parseFromText('[EVENT:delight] then [EVENT:fatigue:0.5]');
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].type, 'delight');
  assert.strictEqual(events[1].type, 'fatigue');
});

test('parseFromText: returns empty array for text with no events', () => {
  const es = makeES();
  const events = es.parseFromText('Nothing special happening here.');
  assert.strictEqual(events.length, 0);
});

test('toKicks: delight produces positive mood and energy kicks', () => {
  const es = makeES();
  const kicks = es.toKicks([{ type: 'delight', intensity: 1.0 }]);
  assert.ok((kicks.mood ?? 0) > 0);
  assert.ok((kicks.energy ?? 0) > 0);
});

test('toKicks: intensity scales kick magnitude', () => {
  const es = makeES();
  const full = es.toKicks([{ type: 'delight', intensity: 1.0 }]);
  const half = es.toKicks([{ type: 'delight', intensity: 0.5 }]);
  assert.ok(Math.abs((full.mood ?? 0) - (half.mood ?? 0) * 2) < 0.001);
});

test('toKicks: multiple events sum their contributions', () => {
  const es = makeES();
  const kicks = es.toKicks([
    { type: 'delight', intensity: 1.0 },
    { type: 'delight', intensity: 1.0 },
  ]);
  const single = es.toKicks([{ type: 'delight', intensity: 1.0 }]);
  assert.ok(Math.abs((kicks.mood ?? 0) - (single.mood ?? 0) * 2) < 0.001);
});

test('toKicks: unknown event type produces no kicks', () => {
  const es = makeES();
  const kicks = es.toKicks([{ type: 'nonsense', intensity: 1.0 }]);
  assert.strictEqual(Object.keys(kicks).length, 0);
});

test('toKicks: schema-defined custom event is recognised', () => {
  const es = makeES();
  const kicks = es.toKicks([{ type: 'custom_cheer', intensity: 1.0 }]);
  assert.ok((kicks.mood ?? 0) > 0);
  assert.ok((kicks.energy ?? 0) > 0);
});

test('validateEvents: returns unknown event types', () => {
  const es = makeES();
  const unknown = es.validateEvents([
    { type: 'delight', intensity: 1.0 },
    { type: 'totally_made_up', intensity: 0.5 },
  ]);
  assert.deepStrictEqual(unknown, ['totally_made_up']);
});

test('validateEvents: returns empty array when all events are known', () => {
  const es = makeES();
  const unknown = es.validateEvents([{ type: 'delight', intensity: 1.0 }]);
  assert.strictEqual(unknown.length, 0);
});

test('BUILTIN_EVENTS covers expected built-in types', () => {
  const expected = ['delight', 'confusion', 'reunion', 'fatigue'];
  for (const e of expected) {
    assert.ok(e in BUILTIN_EVENTS, `Expected ${e} in BUILTIN_EVENTS`);
  }
});
