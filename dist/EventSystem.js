'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventSystem = exports.BUILTIN_EVENTS = void 0;
exports.BUILTIN_EVENTS = {
    delight: { mood: 0.25, energy: 0.15 },
    confusion: { curiosity: -0.20, mood: -0.08 },
    reunion: { affection: 0.30, mood: 0.20, energy: 0.15 },
    fatigue: { energy: -0.25, focus: -0.15, mood: -0.08 },
    frustration: { mood: -0.20, focus: -0.15, energy: -0.10 },
    relief: { mood: 0.20, energy: 0.10 },
    surprise: { curiosity: 0.25, energy: 0.15 },
    boredom: { curiosity: -0.20, focus: -0.15, energy: -0.10 },
};
const EVENT_PATTERN = /\[EVENT:([a-z_]+)(?::([0-9.]+))?\]/gi;
class EventSystem {
    constructor(schema) {
        this.allEvents = { ...exports.BUILTIN_EVENTS, ...(schema.events ?? {}) };
    }
    /** Parse LLM response text for [EVENT:type] or [EVENT:type:intensity] tags. */
    parseFromText(text) {
        const events = [];
        const pattern = new RegExp(EVENT_PATTERN.source, 'gi');
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const type = match[1].toLowerCase();
            const intensity = match[2] !== undefined ? parseFloat(match[2]) : 1.0;
            events.push({ type, intensity: StateEngine_clamp01(intensity) });
        }
        return events;
    }
    /** Convert events to per-variable kick magnitudes, summing if multiple events hit the same variable. */
    toKicks(events) {
        const kicks = {};
        for (const event of events) {
            const template = this.allEvents[event.type];
            if (!template)
                continue;
            for (const [variable, magnitude] of Object.entries(template)) {
                kicks[variable] = (kicks[variable] ?? 0) + magnitude * event.intensity;
            }
        }
        return kicks;
    }
    /** Returns names of any event types that are not recognised (builtin or schema-defined). */
    validateEvents(events) {
        return events
            .map((e) => e.type)
            .filter((t) => !(t in this.allEvents));
    }
}
exports.EventSystem = EventSystem;
function StateEngine_clamp01(v) {
    return Math.min(1, Math.max(0, v));
}
//# sourceMappingURL=EventSystem.js.map