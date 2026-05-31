import { AgentSchema, AgentState } from './StateEngine';
export interface MemoryFile {
    schemaName: string;
    variables: string[];
    state: AgentState;
    growth: {
        delightCount: number;
        sessionCount: number;
    };
    savedAt: number;
}
export declare class Memory {
    private memoryPath;
    constructor(memoryPath: string);
    /** Load state from the memory file. Returns null if the file does not exist. */
    load(): MemoryFile | null;
    /**
     * Atomically persist state to the memory file.
     * Writes to a .tmp file first, then renames — prevents corrupt writes on crash.
     */
    save(data: MemoryFile): void;
    /** True if the saved memory's variable list matches the current schema. */
    isCompatible(saved: MemoryFile, schema: AgentSchema): boolean;
}
//# sourceMappingURL=Memory.d.ts.map