"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const EventSystem_1 = require("../EventSystem");
const SCHEMA = {
    name: 'test',
    variables: ['mood', 'energy', 'curiosity'],
    baselines: { mood: 0.65, energy: 0.70, curiosity: 0.75 },
    homeostasis_rate: 0.08,
    events: {
        custom_cheer: { mood: 0.20, energy: 0.10 },
    },
};
function makeES(overrides = {}) {
    return new EventSystem_1.EventSystem({ ...SCHEMA, ...overrides });
}
(0, node_test_1.test)('parseFromText: parses [EVENT:delight] with default intensity 1.0', () => {
    const es = makeES();
    const events = es.parseFromText('Great job! [EVENT:delight] Keep it up.');
    strict_1.default.strictEqual(events.length, 1);
    strict_1.default.strictEqual(events[0].type, 'delight');
    strict_1.default.strictEqual(events[0].intensity, 1.0);
});
(0, node_test_1.test)('parseFromText: parses [EVENT:confusion:0.3] with explicit intensity', () => {
    const es = makeES();
    const events = es.parseFromText('[EVENT:confusion:0.3]');
    strict_1.default.strictEqual(events.length, 1);
    strict_1.default.strictEqual(events[0].type, 'confusion');
    strict_1.default.ok(Math.abs(events[0].intensity - 0.3) < 0.001);
});
(0, node_test_1.test)('parseFromText: parses multiple events in one string', () => {
    const es = makeES();
    const events = es.parseFromText('[EVENT:delight] then [EVENT:fatigue:0.5]');
    strict_1.default.strictEqual(events.length, 2);
    strict_1.default.strictEqual(events[0].type, 'delight');
    strict_1.default.strictEqual(events[1].type, 'fatigue');
});
(0, node_test_1.test)('parseFromText: returns empty array for text with no events', () => {
    const es = makeES();
    const events = es.parseFromText('Nothing special happening here.');
    strict_1.default.strictEqual(events.length, 0);
});
(0, node_test_1.test)('toKicks: delight produces positive mood and energy kicks', () => {
    const es = makeES();
    const kicks = es.toKicks([{ type: 'delight', intensity: 1.0 }]);
    strict_1.default.ok((kicks.mood ?? 0) > 0);
    strict_1.default.ok((kicks.energy ?? 0) > 0);
});
(0, node_test_1.test)('toKicks: intensity scales kick magnitude', () => {
    const es = makeES();
    const full = es.toKicks([{ type: 'delight', intensity: 1.0 }]);
    const half = es.toKicks([{ type: 'delight', intensity: 0.5 }]);
    strict_1.default.ok(Math.abs((full.mood ?? 0) - (half.mood ?? 0) * 2) < 0.001);
});
(0, node_test_1.test)('toKicks: multiple events sum their contributions', () => {
    const es = makeES();
    const kicks = es.toKicks([
        { type: 'delight', intensity: 1.0 },
        { type: 'delight', intensity: 1.0 },
    ]);
    const single = es.toKicks([{ type: 'delight', intensity: 1.0 }]);
    strict_1.default.ok(Math.abs((kicks.mood ?? 0) - (single.mood ?? 0) * 2) < 0.001);
});
(0, node_test_1.test)('toKicks: unknown event type produces no kicks', () => {
    const es = makeES();
    const kicks = es.toKicks([{ type: 'nonsense', intensity: 1.0 }]);
    strict_1.default.strictEqual(Object.keys(kicks).length, 0);
});
(0, node_test_1.test)('toKicks: schema-defined custom event is recognised', () => {
    const es = makeES();
    const kicks = es.toKicks([{ type: 'custom_cheer', intensity: 1.0 }]);
    strict_1.default.ok((kicks.mood ?? 0) > 0);
    strict_1.default.ok((kicks.energy ?? 0) > 0);
});
(0, node_test_1.test)('validateEvents: returns unknown event types', () => {
    const es = makeES();
    const unknown = es.validateEvents([
        { type: 'delight', intensity: 1.0 },
        { type: 'totally_made_up', intensity: 0.5 },
    ]);
    strict_1.default.deepStrictEqual(unknown, ['totally_made_up']);
});
(0, node_test_1.test)('validateEvents: returns empty array when all events are known', () => {
    const es = makeES();
    const unknown = es.validateEvents([{ type: 'delight', intensity: 1.0 }]);
    strict_1.default.strictEqual(unknown.length, 0);
});
(0, node_test_1.test)('BUILTIN_EVENTS covers expected built-in types', () => {
    const expected = ['delight', 'confusion', 'reunion', 'fatigue'];
    for (const e of expected) {
        strict_1.default.ok(e in EventSystem_1.BUILTIN_EVENTS, `Expected ${e} in BUILTIN_EVENTS`);
    }
});
//# sourceMappingURL=EventSystem.test.js.map