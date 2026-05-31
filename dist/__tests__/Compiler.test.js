"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const Compiler_1 = require("../Compiler");
const SCHEMA = {
    name: 'test',
    variables: ['mood', 'energy', 'curiosity', 'affection', 'focus'],
    baselines: { mood: 0.65, energy: 0.70, curiosity: 0.75, affection: 0.50, focus: 0.60 },
    homeostasis_rate: 0.08,
    compiler: {
        bands: {
            mood: { low: 'a bit flat', mid: 'steady', high: 'bright and joyful' },
            energy: { low: 'low-energy, quiet', mid: 'focused', high: 'bouncy and energised' },
            curiosity: { low: 'mellow', mid: 'interested', high: 'fascinated, full of questions' },
            affection: { low: 'warm', mid: 'fond', high: 'genuinely devoted' },
            focus: { low: 'scattered', mid: 'on task', high: 'deeply absorbed' },
        },
    },
};
function makeState(values) {
    return {
        values,
        noise: {},
        tick: 0,
        timestamp: Date.now(),
    };
}
(0, node_test_1.test)('high mood value produces high band label', () => {
    const c = new Compiler_1.Compiler(SCHEMA);
    const state = makeState({ mood: 0.90, energy: 0.60, curiosity: 0.60, affection: 0.50, focus: 0.60 });
    const output = c.compile(state);
    strict_1.default.ok(output.toLowerCase().includes('bright and joyful'), `Expected high mood label, got: ${output}`);
});
(0, node_test_1.test)('low energy value produces low band label', () => {
    const c = new Compiler_1.Compiler(SCHEMA);
    const state = makeState({ mood: 0.60, energy: 0.20, curiosity: 0.60, affection: 0.50, focus: 0.60 });
    const output = c.compile(state);
    strict_1.default.ok(output.toLowerCase().includes('low-energy'), `Expected low energy label, got: ${output}`);
});
(0, node_test_1.test)('mid-range values produce mid band labels', () => {
    const c = new Compiler_1.Compiler(SCHEMA);
    const state = makeState({ mood: 0.50, energy: 0.50, curiosity: 0.50, affection: 0.50, focus: 0.50 });
    const output = c.compile(state);
    strict_1.default.ok(output.toLowerCase().includes('steady'), `Expected mid mood label, got: ${output}`);
    strict_1.default.ok(output.toLowerCase().includes('focused'), `Expected mid energy label, got: ${output}`);
});
(0, node_test_1.test)('output is a non-empty string ending with a period', () => {
    const c = new Compiler_1.Compiler(SCHEMA);
    const state = makeState({ mood: 0.65, energy: 0.70, curiosity: 0.75, affection: 0.50, focus: 0.60 });
    const output = c.compile(state);
    strict_1.default.ok(output.length > 0, 'Output should not be empty');
    strict_1.default.ok(output.endsWith('.'), `Output should end with period, got: ${output}`);
});
(0, node_test_1.test)('first character is capitalised', () => {
    const c = new Compiler_1.Compiler(SCHEMA);
    const state = makeState({ mood: 0.65, energy: 0.70, curiosity: 0.75, affection: 0.50, focus: 0.60 });
    const output = c.compile(state);
    strict_1.default.ok(output[0] === output[0].toUpperCase(), 'First character should be uppercase');
});
(0, node_test_1.test)('schema with no compiler bands falls back to numeric output', () => {
    const schema = { ...SCHEMA, compiler: { bands: {} } };
    const c = new Compiler_1.Compiler(schema);
    const state = makeState({ mood: 0.65, energy: 0.70, curiosity: 0.75, affection: 0.50, focus: 0.60 });
    const output = c.compile(state);
    // Fallback should mention variable names and numeric values
    strict_1.default.ok(output.includes('mood'), `Fallback should include variable names, got: ${output}`);
});
(0, node_test_1.test)('band thresholds: below 0.35 is low, 0.35–0.65 is mid, above 0.65 is high', () => {
    const schema = {
        ...SCHEMA,
        variables: ['x'],
        baselines: { x: 0.5 },
        compiler: { bands: { x: { low: 'LOW', mid: 'MID', high: 'HIGH' } } },
    };
    const c = new Compiler_1.Compiler(schema);
    strict_1.default.ok(c.compile(makeState({ x: 0.20 })).includes('LOW'));
    strict_1.default.ok(c.compile(makeState({ x: 0.50 })).includes('MID'));
    strict_1.default.ok(c.compile(makeState({ x: 0.80 })).includes('HIGH'));
    // Boundary values
    strict_1.default.ok(c.compile(makeState({ x: 0.35 })).includes('MID'));
    strict_1.default.ok(c.compile(makeState({ x: 0.65 })).includes('MID'));
});
(0, node_test_1.test)('circadian sentence appended when schema has circadian', () => {
    const schemaWithCircadian = {
        ...SCHEMA,
        circadian: { peaks: ['09:00', '14:00'], floor: 0.15 },
    };
    const c = new Compiler_1.Compiler(schemaWithCircadian);
    const state = makeState({ mood: 0.65, energy: 0.70, curiosity: 0.75, affection: 0.50, focus: 0.60 });
    const output = c.compile(state);
    // Output should have more than one sentence
    const sentences = output.split('.').filter((s) => s.trim().length > 0);
    strict_1.default.ok(sentences.length >= 2, `Expected circadian sentence, got: ${output}`);
});
//# sourceMappingURL=Compiler.test.js.map