"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const Memory_1 = require("../Memory");
function tmpPath() {
    return path_1.default.join(os_1.default.tmpdir(), `animus-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}
const SCHEMA = {
    name: 'test-agent',
    variables: ['mood', 'energy'],
    baselines: { mood: 0.65, energy: 0.70 },
    homeostasis_rate: 0.08,
};
const STATE = {
    values: { mood: 0.70, energy: 0.65 },
    noise: { mood: 0.01, energy: -0.01 },
    tick: 10,
    timestamp: 1700000000000,
};
const MEMORY_DATA = {
    schemaName: 'test-agent',
    variables: ['mood', 'energy'],
    state: STATE,
    growth: { delightCount: 3, sessionCount: 1 },
    savedAt: Date.now(),
};
(0, node_test_1.test)('load returns null when file does not exist', () => {
    const m = new Memory_1.Memory('/tmp/does-not-exist-animus.json');
    strict_1.default.strictEqual(m.load(), null);
});
(0, node_test_1.test)('save and load round-trip preserves state values', () => {
    const p = tmpPath();
    try {
        const m = new Memory_1.Memory(p);
        m.save(MEMORY_DATA);
        const loaded = m.load();
        strict_1.default.ok(loaded !== null);
        strict_1.default.strictEqual(loaded.state.values.mood, 0.70);
        strict_1.default.strictEqual(loaded.state.values.energy, 0.65);
        strict_1.default.strictEqual(loaded.state.tick, 10);
    }
    finally {
        if (fs_1.default.existsSync(p))
            fs_1.default.unlinkSync(p);
    }
});
(0, node_test_1.test)('save and load round-trip preserves growth data', () => {
    const p = tmpPath();
    try {
        const m = new Memory_1.Memory(p);
        m.save(MEMORY_DATA);
        const loaded = m.load();
        strict_1.default.strictEqual(loaded.growth.delightCount, 3);
        strict_1.default.strictEqual(loaded.growth.sessionCount, 1);
    }
    finally {
        if (fs_1.default.existsSync(p))
            fs_1.default.unlinkSync(p);
    }
});
(0, node_test_1.test)('save creates directory if it does not exist', () => {
    const dir = path_1.default.join(os_1.default.tmpdir(), `animus-dir-${Date.now()}`);
    const p = path_1.default.join(dir, 'agent.memory.json');
    try {
        const m = new Memory_1.Memory(p);
        m.save(MEMORY_DATA);
        strict_1.default.ok(fs_1.default.existsSync(p), 'Memory file should be created');
    }
    finally {
        if (fs_1.default.existsSync(p))
            fs_1.default.unlinkSync(p);
        if (fs_1.default.existsSync(dir))
            fs_1.default.rmdirSync(dir);
    }
});
(0, node_test_1.test)('save writes valid JSON', () => {
    const p = tmpPath();
    try {
        const m = new Memory_1.Memory(p);
        m.save(MEMORY_DATA);
        const raw = fs_1.default.readFileSync(p, 'utf8');
        strict_1.default.doesNotThrow(() => JSON.parse(raw));
    }
    finally {
        if (fs_1.default.existsSync(p))
            fs_1.default.unlinkSync(p);
    }
});
(0, node_test_1.test)('atomic write: no .tmp file left after save', () => {
    const p = tmpPath();
    try {
        const m = new Memory_1.Memory(p);
        m.save(MEMORY_DATA);
        strict_1.default.ok(!fs_1.default.existsSync(p + '.tmp'), '.tmp file should not exist after save');
    }
    finally {
        if (fs_1.default.existsSync(p))
            fs_1.default.unlinkSync(p);
    }
});
(0, node_test_1.test)('isCompatible: true when variable lists match', () => {
    const m = new Memory_1.Memory(tmpPath());
    strict_1.default.ok(m.isCompatible(MEMORY_DATA, SCHEMA));
});
(0, node_test_1.test)('isCompatible: false when schema has different variables', () => {
    const m = new Memory_1.Memory(tmpPath());
    const newSchema = { ...SCHEMA, variables: ['mood', 'energy', 'curiosity'] };
    strict_1.default.ok(!m.isCompatible(MEMORY_DATA, newSchema));
});
(0, node_test_1.test)('isCompatible: true regardless of variable list order', () => {
    const m = new Memory_1.Memory(tmpPath());
    const reorderedData = { ...MEMORY_DATA, variables: ['energy', 'mood'] };
    strict_1.default.ok(m.isCompatible(reorderedData, SCHEMA));
});
(0, node_test_1.test)('Animus integration: save then load restores state across instances', () => {
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
        strict_1.default.ok(Math.abs(b.getState().values.mood - stateAfterDelight) < 0.001, 'Loaded state should match saved state');
    }
    finally {
        if (fs_1.default.existsSync(p))
            fs_1.default.unlinkSync(p);
    }
});
//# sourceMappingURL=Memory.test.js.map