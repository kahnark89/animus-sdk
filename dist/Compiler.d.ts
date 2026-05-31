import { AgentSchema, AgentState } from './StateEngine';
export declare class Compiler {
    private schema;
    constructor(schema: AgentSchema);
    /**
     * Compile the current state into a single mood-line paragraph.
     * This is the ONLY interface the LLM should receive — never raw state values.
     */
    compile(state: AgentState, nowMs?: number): string;
    private band;
    private buildParagraph;
    private circadianSentence;
}
//# sourceMappingURL=Compiler.d.ts.map