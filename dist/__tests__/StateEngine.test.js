"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const StateEngine_1 = require("../StateEngine");
const SCHEMA = {
    name: 'test-agent',
    variables: ['mood', 'energy', 'curiosity'],
    baselines: { mood: 0.65, energy: 0.70, curiosity: 0.75 },
    homeostasis_rate: 0.08,
    coupling: { energy: { mood: 0.30 } },
    circadian: { peaks: ['09:00', '14:00'], floor: 0.15 },
    noise: { magnitude: 0.02, autocorrelation: 0.70 },
};
function makeEngine(overrides = {}) {
    return new StateEngine_1.StateEngine({ ...SCHEMA, ...overrides });
}
(0, node_test_1.test)('initialState sets values to baselines with zero noise', () => {
    const engine = makeEngine();
    const state = engine.initialState();
    strict_1.default.strictEqual(state.values.mood, 0.65);
    strict_1.default.strictEqual(state.values.energy, 0.70);
    strict_1.default.strictEqual(state.values.curiosity, 0.75);
    strict_1.default.strictEqual(state.noise.mood, 0);
    strict_1.default.strictEqual(state.tick, 0);
});
(0, node_test_1.test)('tick increments tick counter', () => {
    const engine = makeEngine();
    let state = engine.initialState();
    state = engine.tick(state);
    strict_1.default.strictEqual(state.tick, 1);
    state = engine.tick(state);
    strict_1.default.strictEqual(state.tick, 2);
});
(0, node_test_1.test)('all values stay within [0, 1] after 100 ticks', () => {
    const engine = makeEngine();
    let state = engine.initialState();
    for (let i = 0; i < 100; i++) {
        state = engine.tick(state);
        for (const v of SCHEMA.variables) {
            const val = state.values[v];
            strict_1.default.ok(val >= 0 && val <= 1, `${v}=${val} out of range at tick ${i + 1}`);
        }
    }
});
(0, node_test_1.test)('positive kick raises target variable', () => {
    const engine = makeEngine({ noise: { magnitude: 0, autocorrelation: 0 } });
    const state = engine.initialState();
    const kicked = engine.tick(state, { mood: 0.30 });
    strict_1.default.ok(kicked.values.mood > state.values.mood, 'mood should increase after positive kick');
});
(0, node_test_1.test)('negative kick lowers target variable', () => {
    const engine = makeEngine({ noise: { magnitude: 0, autocorrelation: 0 } });
    const state = engine.initialState();
    const kicked = engine.tick(state, { energy: -0.40 });
    strict_1.default.ok(kicked.values.energy < state.values.energy, 'energy should decrease after negative kick');
});
(0, node_test_1.test)('homeostasis pulls value toward baseline', () => {
    const engine = makeEngine({ noise: { magnitude: 0, autocorrelation: 0 } });
    let state = engine.initialState();
    state.values.mood = 0.10;
    state = engine.tick(state);
    strict_1.default.ok(state.values.mood > 0.10, 'mood should move toward baseline (0.65)');
});
(0, node_test_1.test)('clamp01 keeps values within bounds', () => {
    strict_1.default.strictEqual(StateEngine_1.StateEngine.clamp01(-5), 0);
    strict_1.default.strictEqual(StateEngine_1.StateEngine.clamp01(1.5), 1);
    strict_1.default.strictEqual(StateEngine_1.StateEngine.clamp01(0.5), 0.5);
});
(0, node_test_1.test)('computeEffectiveBaseline: energy is lower at midnight than at peak (09:00)', () => {
    const engine = makeEngine();
    const midnight = new Date('2024-01-01T00:00:00').getTime();
    const morning = new Date('2024-01-01T09:00:00').getTime();
    const midnightBaseline = engine.computeEffectiveBaseline('energy', midnight);
    const morningBaseline = engine.computeEffectiveBaseline('energy', morning);
    strict_1.default.ok(morningBaseline > midnightBaseline, 'energy baseline should be higher at 09:00 than midnight');
});
(0, node_test_1.test)('computeEffectiveBaseline: circadian does not affect mood', () => {
    const engine = makeEngine();
    const midnight = new Date('2024-01-01T00:00:00').getTime();
    const morning = new Date('2024-01-01T09:00:00').getTime();
    strict_1.default.strictEqual(engine.computeEffectiveBaseline('mood', midnight), engine.computeEffectiveBaseline('mood', morning), 'mood baseline should not vary with circadian');
});
(0, node_test_1.test)('computeCoupling: elevated mood raises energy coupling contribution', () => {
    const engine = makeEngine({ noise: { magnitude: 0, autocorrelation: 0 } });
    const state = engine.initialState();
    const highMoodState = { ...state, values: { ...state.values, mood: 0.95 } };
    const coupling = engine.computeCoupling('energy', highMoodState);
    strict_1.default.ok(coupling > 0, 'elevated mood should produce positive coupling for energy');
});
(0, node_test_1.test)('no coupling when schema has no coupling section', () => {
    const engine = makeEngine({ coupling: undefined });
    const state = engine.initialState();
    strict_1.default.strictEqual(engine.computeCoupling('energy', state), 0);
});
//# sourceMappingURL=StateEngine.test.js.map