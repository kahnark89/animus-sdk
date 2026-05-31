import { AgentSchema } from './StateEngine';
export interface AnimusEvent {
    type: string;
    intensity: number;
}
export declare const BUILTIN_EVENTS: Record<string, Record<string, number>>;
export declare class EventSystem {
    private allEvents;
    constructor(schema: AgentSchema);
    /** Parse LLM response text for [EVENT:type] or [EVENT:type:intensity] tags. */
    parseFromText(text: string): AnimusEvent[];
    /** Convert events to per-variable kick magnitudes, summing if multiple events hit the same variable. */
    toKicks(events: AnimusEvent[]): Record<string, number>;
    /** Returns names of any event types that are not recognised (builtin or schema-defined). */
    validateEvents(events: AnimusEvent[]): string[];
}
//# sourceMappingURL=EventSystem.d.ts.map