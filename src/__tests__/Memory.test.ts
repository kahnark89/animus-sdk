import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Memory, MemoryFile } from '../Memory';
import { AgentSchema, AgentState } from '../StateEngine';

function tmpPath(): string {
  return path.join(os.tmpdir(), `animus-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

const SCHEMA: AgentSchema = {
  name: 'test-agent',
  variables: ['mood', 'energy'],
  baselines: { mood: 0.65, energy: 0.70 },
  homeostasis_rate: 0.08,
};

const STATE: AgentState = {
  values: { mood: 0.70, energy: 0.65 },
  noise: { mood: 0.01, energy: -0.01 },
  tick: 10,
  timestamp: 1700000000000,
};

const MEMORY_DATA: MemoryFile = {
  schemaName: 'test-agent',
  variables: ['mood', 'energy'],
  state: STATE,
  growth: { delightCount: 3, sessionCount: 1 },
  savedAt: Date.now(),
};

test('load returns null when file does not exist', () => {
  const m = new Memory('/tmp/does-not-exist-animus.json');
  assert.strictEqual(m.load(), null);
});

test('save and load round-trip preserves state values', () => {
  const p = tmpPath();
  try {
    const m = new Memory(p);
    m.save(MEMORY_DATA);
    const loaded = m.load();
    assert.ok(loaded !== null);
    assert.strictEqual(loaded!.state.values.mood, 0.70);
    assert.strictEqual(loaded!.state.values.energy, 0.65);
    assert.strictEqual(loaded!.state.tick, 10);
  } finally {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

test('save and load round-trip preserves growth data', () => {
  const p = tmpPath();
  try {
    const m = new Memory(p);
    m.save(MEMORY_DATA);
    const loaded = m.load();
    assert.strictEqual(loaded!.growth.delightCount, 3);
    assert.strictEqual(loaded!.growth.sessionCount, 1);
  } finally {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

test('save creates directory if it does not exist', () => {
  const dir = path.join(os.tmpdir(), `animus-dir-${Date.now()}`);
  const p = path.join(dir, 'agent.memory.json');
  try {
    const m = new Memory(p);
    m.save(MEMORY_DATA);
    assert.ok(fs.existsSync(p), 'Memory file should be created');
  } finally {
    if (fs.existsSync(p)) fs.unlinkSync(p);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  }
});

test('save writes valid JSON', () => {
  const p = tmpPath();
  try {
    const m = new Memory(p);
    m.save(MEMORY_DATA);
    const raw = fs.readFileSync(p, 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw));
  } finally {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

test('atomic write: no .tmp file left after save', () => {
  const p = tmpPath();
  try {
    const m = new Memory(p);
    m.save(MEMORY_DATA);
    assert.ok(!fs.existsSync(p + '.tmp'), '.tmp file should not exist after save');
  } finally {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

test('isCompatible: true when variable lists match', () => {
  const m = new Memory(tmpPath());
  assert.ok(m.isCompatible(MEMORY_DATA, SCHEMA));
});

test('isCompatible: false when schema has different variables', () => {
  const m = new Memory(tmpPath());
  const newSchema: AgentSchema = { ...SCHEMA, variables: ['mood', 'energy', 'curiosity'] };
  assert.ok(!m.isCompatible(MEMORY_DATA, newSchema));
});

test('isCompatible: true regardless of variable list order', () => {
  const m = new Memory(tmpPath());
  const reorderedData: MemoryFile = { ...MEMORY_DATA, variables: ['energy', 'mood'] };
  assert.ok(m.isCompatible(reorderedData, SCHEMA));
});

test('Animus integration: save then load restores state across instances', () => {
  const p = tmpPath();
  const { Animus } = require('../index');
  try {
    const schema = {
      name: 'integration-test',
      variables: ['mood', 'energy'],
      baselines: { mood: 0.65, energy: 0.70 },
      homeostasis_rate: 0.08,
    };
    const a = new Animus({ schema, memory: p });
    a.apply([{ type: 'delight', intensity: 1.0 }]);
    const stateAfterDelight = a.getState().values.mood;
    a.save();

    const b = new Animus({ schema, memory: p });
    assert.ok(
      Math.abs(b.getState().values.mood - stateAfterDelight) < 0.001,
      'Loaded state should match saved state'
    );
  } finally {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});
