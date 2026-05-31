import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StateEngine, AgentSchema, AgentState } from '../StateEngine';

const SCHEMA: AgentSchema = {
  name: 'test-agent',
  variables: ['mood', 'energy', 'curiosity'],
  baselines: { mood: 0.65, energy: 0.70, curiosity: 0.75 },
  homeostasis_rate: 0.08,
  coupling: { energy: { mood: 0.30 } },
  circadian: { peaks: ['09:00', '14:00'], floor: 0.15 },
  noise: { magnitude: 0.02, autocorrelation: 0.70 },
};

function makeEngine(overrides: Partial<AgentSchema> = {}): StateEngine {
  return new StateEngine({ ...SCHEMA, ...overrides });
}

test('initialState sets values to baselines with zero noise', () => {
  const engine = makeEngine();
  const state = engine.initialState();
  assert.strictEqual(state.values.mood, 0.65);
  assert.strictEqual(state.values.energy, 0.70);
  assert.strictEqual(state.values.curiosity, 0.75);
  assert.strictEqual(state.noise.mood, 0);
  assert.strictEqual(state.tick, 0);
});

test('tick increments tick counter', () => {
  const engine = makeEngine();
  let state = engine.initialState();
  state = engine.tick(state);
  assert.strictEqual(state.tick, 1);
  state = engine.tick(state);
  assert.strictEqual(state.tick, 2);
});

test('all values stay within [0, 1] after 100 ticks', () => {
  const engine = makeEngine();
  let state = engine.initialState();
  for (let i = 0; i < 100; i++) {
    state = engine.tick(state);
    for (const v of SCHEMA.variables) {
      const val = state.values[v];
      assert.ok(val >= 0 && val <= 1, `${v}=${val} out of range at tick ${i + 1}`);
    }
  }
});

test('positive kick raises target variable', () => {
  const engine = makeEngine({ noise: { magnitude: 0, autocorrelation: 0 } });
  const state = engine.initialState();
  const kicked = engine.tick(state, { mood: 0.30 });
  assert.ok(kicked.values.mood > state.values.mood, 'mood should increase after positive kick');
});

test('negative kick lowers target variable', () => {
  const engine = makeEngine({ noise: { magnitude: 0, autocorrelation: 0 } });
  const state = engine.initialState();
  const kicked = engine.tick(state, { energy: -0.40 });
  assert.ok(kicked.values.energy < state.values.energy, 'energy should decrease after negative kick');
});

test('homeostasis pulls value toward baseline', () => {
  const engine = makeEngine({ noise: { magnitude: 0, autocorrelation: 0 } });
  let state = engine.initialState();
  state.values.mood = 0.10;
  state = engine.tick(state);
  assert.ok(state.values.mood > 0.10, 'mood should move toward baseline (0.65)');
});

test('clamp01 keeps values within bounds', () => {
  assert.strictEqual(StateEngine.clamp01(-5), 0);
  assert.strictEqual(StateEngine.clamp01(1.5), 1);
  assert.strictEqual(StateEngine.clamp01(0.5), 0.5);
});

test('computeEffectiveBaseline: energy is lower at midnight than at peak (09:00)', () => {
  const engine = makeEngine();
  const midnight = new Date('2024-01-01T00:00:00').getTime();
  const morning = new Date('2024-01-01T09:00:00').getTime();
  const midnightBaseline = engine.computeEffectiveBaseline('energy', midnight);
  const morningBaseline = engine.computeEffectiveBaseline('energy', morning);
  assert.ok(morningBaseline > midnightBaseline, 'energy baseline should be higher at 09:00 than midnight');
});

test('computeEffectiveBaseline: circadian does not affect mood', () => {
  const engine = makeEngine();
  const midnight = new Date('2024-01-01T00:00:00').getTime();
  const morning = new Date('2024-01-01T09:00:00').getTime();
  assert.strictEqual(
    engine.computeEffectiveBaseline('mood', midnight),
    engine.computeEffectiveBaseline('mood', morning),
    'mood baseline should not vary with circadian'
  );
});

test('computeCoupling: elevated mood raises energy coupling contribution', () => {
  const engine = makeEngine({ noise: { magnitude: 0, autocorrelation: 0 } });
  const state = engine.initialState();
  const highMoodState: AgentState = { ...state, values: { ...state.values, mood: 0.95 } };
  const coupling = engine.computeCoupling('energy', highMoodState);
  assert.ok(coupling > 0, 'elevated mood should produce positive coupling for energy');
});

test('no coupling when schema has no coupling section', () => {
  const engine = makeEngine({ coupling: undefined });
  const state = engine.initialState();
  assert.strictEqual(engine.computeCoupling('energy', state), 0);
});
