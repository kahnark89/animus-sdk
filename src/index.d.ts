export interface PersonaTraits {
  valence: number;
  arousal: number;
  stability: number;
  sociability: number;
  drive: number;
}

export interface AnimusPersona {
  seed: number;
  traits: PersonaTraits;
  voice: 'direct' | 'vivid' | 'physiological' | 'social';
}

export interface AnimusTrigger {
  condition: string;   // "elapsed_days > 1", "energy < 0.20", "delight_count > 50", etc.
  fire: string | string[];
  intensity?: number;
  cooldown_steps?: number;
}

export interface AnimusGrowthRule {
  trigger: string;    // same condition language as AnimusTrigger
  shifts: Record<string, number>;
}

export interface AnimusSchema {
  name?: string;
  variables: string[];
  baselines: Record<string, number>;
  homeostasis_rate?: number;            // λ, default 0.08
  step_minutes?: number;                // wall-clock minutes per step, default 1
  coupling?: Record<string, Record<string, number>>; // coupling[source][target] = κ
  circadian?: { peaks: string[]; floor?: number; width_minutes?: number; applies_to?: string[] };
  noise?: { magnitude?: number; autocorrelation?: number };
  events?: Record<string, Record<string, number>>;   // events[name][variable] = kick at intensity 1
  event_sensitivity?: Record<string, number>;        // scales each event's kick magnitude (default 1.0)
  triggers?: AnimusTrigger[];           // auto-fire events on elapsed time or state thresholds
  growth?: { rules: AnimusGrowthRule[] }; // permanent baseline shifts after N events
  persona?: { seed: number } | AnimusPersona; // integer seed → auto-generate personality physics
  compiler?: { thresholds?: [number, number]; bands?: Record<string, { very_low?: string | string[]; low?: string | string[]; mid?: string | string[]; high?: string | string[]; very_high?: string | string[] }> } & Record<string, { low: string; mid: string; high: string }>;
}

export interface AnimusEvent { type: string; intensity?: number; }

export interface AnimusOptions {
  schema: string | AnimusSchema;  // path to JSON, or the object itself
  memory?: string;                // path to persistent state db (JSON); omit for in-memory
  now?: () => Date;               // injectable clock (tests)
  rng?: () => number;             // injectable randomness (tests)
}

export declare class Animus {
  constructor(opts: AnimusOptions);
  /** Advance state by elapsed wall-clock time (homeostasis, circadian, noise). */
  tick(now?: Date): this;
  /** Apply events as one kicked update step. */
  apply(events: AnimusEvent[]): this;
  /** Store an episodic beat; salience decays with a 7-day halflife. */
  remember(text: string, salience?: number): this;
  /**
   * Log topics from a conversation turn. Call after each LLM exchange.
   * Accepts a comma/semicolon-separated string or an array of topic phrases.
   * The engine tracks frequency × recency and surfaces the top topics automatically in compile().
   */
  gist(topics: string | string[]): this;
  /** Top N topics by frequency × recency (from gist() calls and remember() beats). */
  topMemories(n?: number): string[];
  /** Most salient surviving topic, or null. Kept for backward compat; topMemories() is richer. */
  topMemory(): string | null;
  /** Tick to now and compile state into the mood-line paragraph for your LLM call. */
  compile(): string;
  /** Read-only copy of the current state vector. */
  state(): Record<string, number>;
  /** Extract [[event:intensity]] tags from LLM output (unknown tags ignored). */
  parseEvents(text: string): AnimusEvent[];
  /** LLM output with event tags removed. */
  cleanText(text: string): string;
  static parseEvents(text: string, schema?: AnimusSchema): AnimusEvent[];
  static stripEventTags(text: string): string;
  /** Generate a complete schema from a 32-bit integer seed. Pass base to preserve name/variables/events. */
  static generatePersona(seed: number, base?: Partial<AnimusSchema>): AnimusSchema;
}

export declare const engine: {
  step(state: Record<string, number>, schema: AnimusSchema,
       opts?: { date?: Date; rng?: () => number; kicks?: Record<string, number>; noiseState?: Record<string, number> }):
       { state: Record<string, number>; noiseState: Record<string, number> };
  eventsToKicks(events: AnimusEvent[], schema: AnimusSchema): Record<string, number>;
  compile(state: Record<string, number>, schema: AnimusSchema, opts?: { date?: Date; memory?: string | null; trends?: Record<string, 'rising' | 'falling'> }): string;
  band(v: number, thresholds?: [number, number]): 'low' | 'mid' | 'high';
  band5(v: number): 'very_low' | 'low' | 'mid' | 'high' | 'very_high';
  parseEvents(text: string, schema?: AnimusSchema): AnimusEvent[];
  stripEventTags(text: string): string;
  circadianFactor(schema: AnimusSchema, date: Date): number;
  effectiveBaselines(schema: AnimusSchema, date: Date): Record<string, number>;
  BUILTIN_EVENTS: Record<string, Record<string, number>>;
};
