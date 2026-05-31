import { AgentSchema, AgentState, StateEngine } from './StateEngine';
import { AnimusEvent, EventSystem } from './EventSystem';
import { Compiler } from './Compiler';
import { Memory, MemoryFile } from './Memory';
export interface AnimusConfig {
    schema: string | AgentSchema;
    memory?: string;
}
export declare class Animus {
    private schema;
    private state;
    private engine;
    private compiler;
    private eventSystem;
    private memory;
    private memoryPath;
    constructor(config: AnimusConfig);
    /**
     * Compile current state to a mood-line paragraph.
     * Safe to call multiple times — does NOT advance state.
     * This is the ONLY state data that should be injected into an LLM prompt.
     */
    compile(): string;
    /**
     * Apply events (typically parsed from an LLM response) and advance one tick.
     */
    apply(events: AnimusEvent[]): void;
    /**
     * Advance one tick without any events (natural time-passage).
     */
    tick(): void;
    /** Persist current state to the memory file. */
    save(): void;
    /** Reload state from the memory file, overwriting in-memory state. */
    load(): void;
    /** Returns raw state. For debugging/simulator only — do NOT inject into LLM prompts. */
    getState(): AgentState;
    getSchema(): AgentSchema;
}
export type { AgentSchema, AgentState, AnimusEvent, MemoryFile };
export { EventSystem, StateEngine, Compiler, Memory };
export { BUILTIN_EVENTS } from './EventSystem';
//# sourceMappingURL=index.d.ts.map