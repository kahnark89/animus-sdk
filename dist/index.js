'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BUILTIN_EVENTS = exports.Memory = exports.Compiler = exports.StateEngine = exports.EventSystem = exports.Animus = void 0;
const fs_1 = __importDefault(require("fs"));
const StateEngine_1 = require("./StateEngine");
Object.defineProperty(exports, "StateEngine", { enumerable: true, get: function () { return StateEngine_1.StateEngine; } });
const EventSystem_1 = require("./EventSystem");
Object.defineProperty(exports, "EventSystem", { enumerable: true, get: function () { return EventSystem_1.EventSystem; } });
const Compiler_1 = require("./Compiler");
Object.defineProperty(exports, "Compiler", { enumerable: true, get: function () { return Compiler_1.Compiler; } });
const Memory_1 = require("./Memory");
Object.defineProperty(exports, "Memory", { enumerable: true, get: function () { return Memory_1.Memory; } });
class Animus {
    constructor(config) {
        if (typeof config.schema === 'string') {
            this.schema = JSON.parse(fs_1.default.readFileSync(config.schema, 'utf8'));
        }
        else {
            this.schema = config.schema;
        }
        this.memoryPath = config.memory ?? 'animus/agent.memory.json';
        this.engine = new StateEngine_1.StateEngine(this.schema);
        this.compiler = new Compiler_1.Compiler(this.schema);
        this.eventSystem = new EventSystem_1.EventSystem(this.schema);
        this.memory = new Memory_1.Memory(this.memoryPath);
        const saved = this.memory.load();
        if (saved && this.memory.isCompatible(saved, this.schema)) {
            this.state = saved.state;
        }
        else {
            this.state = this.engine.initialState();
        }
    }
    /**
     * Compile current state to a mood-line paragraph.
     * Safe to call multiple times — does NOT advance state.
     * This is the ONLY state data that should be injected into an LLM prompt.
     */
    compile() {
        return this.compiler.compile(this.state);
    }
    /**
     * Apply events (typically parsed from an LLM response) and advance one tick.
     */
    apply(events) {
        const kicks = this.eventSystem.toKicks(events);
        this.state = this.engine.tick(this.state, kicks);
    }
    /**
     * Advance one tick without any events (natural time-passage).
     */
    tick() {
        this.state = this.engine.tick(this.state);
    }
    /** Persist current state to the memory file. */
    save() {
        const data = {
            schemaName: this.schema.name,
            variables: this.schema.variables,
            state: this.state,
            growth: { delightCount: 0, sessionCount: 0 },
            savedAt: Date.now(),
        };
        this.memory.save(data);
    }
    /** Reload state from the memory file, overwriting in-memory state. */
    load() {
        const saved = this.memory.load();
        if (saved && this.memory.isCompatible(saved, this.schema)) {
            this.state = saved.state;
        }
    }
    /** Returns raw state. For debugging/simulator only — do NOT inject into LLM prompts. */
    getState() {
        return this.state;
    }
    getSchema() {
        return this.schema;
    }
}
exports.Animus = Animus;
var EventSystem_2 = require("./EventSystem");
Object.defineProperty(exports, "BUILTIN_EVENTS", { enumerable: true, get: function () { return EventSystem_2.BUILTIN_EVENTS; } });
//# sourceMappingURL=index.js.map