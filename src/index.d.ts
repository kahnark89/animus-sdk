// ─── Schema types ─────────────────────────────────────────────────────────────

export interface AnimusSecondOrder {
  natural_freq?: number;    // ω — oscillator frequency (default 0.08)
  damping_ratio?: number;   // ζ — damping (default 0.90, range 0.65–0.98)
}

export interface AnimusSetpointDrift {
  max?: number;             // maximum cumulative drift from baseline (default 0.12)
  rate_per_day?: number;    // Brownian step size per day (default 0.015)
  threshold_days?: number;  // minimum absence before drift activates (default 0.5)
}

export interface AnimusTrigger {
  condition: string;        // "elapsed_days > 1", "energy < 0.20", "delight_count > 50"
  fire: string | string[];
  intensity?: number;
  cooldown_steps?: number;
}

export interface AnimusGrowthRule {
  trigger: string;
  shifts: Record<string, number>;
}

export interface AnimusSchema {
  id?: string;              // used as default memory filename (.animus/{id}.json)
  name?: string;
  variables?: string[];
  baselines: Record<string, number>;
  homeostasis_rate?: number;
  step_minutes?: number;
  coupling?: Record<string, Record<string, number>>;
  circadian?: {
    peaks: number[];        // peak hours as numbers e.g. [9, 14] (NOT strings)
    floor?: number;
    width_minutes?: number;
    applies_to?: string[];
  };
  noise?: { magnitude?: number; autocorrelation?: number };
  events?: Record<string, Record<string, number>>;
  event_sensitivity?: Record<string, number>;
  triggers?: AnimusTrigger[];
  growth?: { rules: AnimusGrowthRule[] };
  second_order?: AnimusSecondOrder;
  setpoint_drift?: AnimusSetpointDrift;
  compiler?: Record<string, unknown>;
  /** Internal — trait values stored by generatePersona for social coupling */
  _traits?: {
    valence: number;
    arousal: number;
    stability: number;
    sociability: number;
    drive: number;
  };
}

export interface AnimusEvent {
  type: string;
  intensity?: number;
}

export interface AnimusOptions {
  schema: AnimusSchema;
  /** Path to JSON state file. Defaults to .animus/{schema.id}.json */
  memoryPath?: string;
  /** Enable zero-config event inference from raw LLM text (default false) */
  infer?: boolean;
  /** Force second-order dynamics on (true) or off (false); overrides schema */
  secondOrder?: boolean;
}

export interface AnimusExport {
  db: object;
  schema_id?: string;
  exported_at: number;
}

export interface AnimusDiagnosticVar {
  value: number;
  velocity: number;
  noise: number;
  band: string;
  effectiveBaseline: number;
}

export interface AnimusDiagnostic {
  schema_id?: string;
  secondOrderEnabled: boolean;
  variables: Record<string, AnimusDiagnosticVar>;
  circadianFactor: number;
  compiledMood: string;
}

/** Peer descriptor for social influence in compile() */
export interface AnimusPeer {
  state: Record<string, number>;
  schema: AnimusSchema;
  strength: number;
}

// ─── Animus class ─────────────────────────────────────────────────────────────

export declare class Animus {
  readonly schema: AnimusSchema;
  readonly memoryPath: string;

  constructor(opts: AnimusOptions);

  /**
   * Two-line cold start. Generates a persona from a 32-bit seed.
   * @example const a = Animus.create(42); const mood = a.compile();
   */
  static create(seed: number, opts?: Partial<Omit<AnimusOptions, 'schema'>>): Animus;

  // ─── Core lifecycle ──────────────────────────────────────────────────────

  /** Advance state and return mood-line for injection into your LLM system prompt. */
  compile(peers?: AnimusPeer[]): string;

  /**
   * Apply events from an LLM exchange.
   * Accepts a structured events array or raw LLM text (auto-parses [[event:intensity]] tags).
   */
  apply(events: AnimusEvent[] | string, opts?: { inferFallback?: boolean }): this;

  // ─── Memory ──────────────────────────────────────────────────────────────

  /** Store an episodic memory beat (7-day salience half-life). */
  remember(text: string, salience?: number): this;

  /** Log topics from an LLM exchange; tracked by frequency × recency. */
  gist(topics: string | string[]): this;

  /** Top N memories by salience-weighted recency. */
  topMemories(n?: number): string[];

  // ─── State accessors ─────────────────────────────────────────────────────

  /** Read-only copy of the current state vector. Property, not a function. */
  readonly state: Record<string, number>;

  /** Full diagnostic snapshot (velocity, noise, band, effectiveBaseline per variable). */
  diagnose(): AnimusDiagnostic;

  // ─── Social coupling ─────────────────────────────────────────────────────

  /** Register a peer Animus for emotional contagion on every compile(). */
  couple(peer: Animus, strength?: number): this;

  /** Remove a peer coupling. */
  decouple(peer: Animus): this;

  // ─── Framework helpers ────────────────────────────────────────────────────

  /** Prepend mood-line to a system prompt string. */
  toSystemPrompt(baseSystemPrompt?: string): string;

  /** Vercel AI SDK wrapLanguageModel-compatible middleware object. */
  toMiddleware(): { wrapGenerate: Function };

  /** LangGraph-compatible state node payload. */
  toLangChainState(): {
    animus_mood: string;
    animus_state: Record<string, number>;
    animus_schema_id?: string;
  };

  // ─── Serialization ────────────────────────────────────────────────────────

  /** Export full state for database / Redis storage. */
  export(): AnimusExport;

  /** Import previously exported state. */
  import(data: AnimusExport): this;

  // ─── Text utilities ───────────────────────────────────────────────────────

  /** Parse [[event:intensity]] tags from LLM output. */
  parseEvents(text: string): AnimusEvent[];

  /** Strip event tags from LLM output for clean display. */
  cleanText(text: string): string;
}

// ─── Engine export ────────────────────────────────────────────────────────────

export declare const engine: {
  VARS: string[];
  KICK_TABLE: Record<string, Record<string, number>>;

  /** Run N physics steps. Returns updated state, velocityState, noiseState. */
  runSteps(
    state: Record<string, number>,
    velocityState: Record<string, number>,
    noiseState: Record<string, number>,
    schema: AnimusSchema,
    nowMs: number,
    steps: number,
    kicks: Record<string, number> | null
  ): {
    state: Record<string, number>;
    velocityState: Record<string, number>;
    noiseState: Record<string, number>;
  };

  /** Convert event array to kick magnitudes for runSteps(). */
  eventsToKicks(events: AnimusEvent[], schema: AnimusSchema): Record<string, number>;

  /** Compile state into natural-language mood-line. */
  compile(
    state: Record<string, number>,
    schema: AnimusSchema,
    nowMs: number,
    prevState: Record<string, number> | null,
    memories: string[]
  ): string;

  /** Bounded Brownian walk on baselines during absence. */
  driftSetpoints(
    baselineShifts: Record<string, number>,
    schema: AnimusSchema,
    elapsedDays: number
  ): Record<string, number>;

  /** Compute social influence kicks from peer states (PAD-grounded, sociability-scaled). */
  socialInfluenceKicks(
    selfSchema: AnimusSchema,
    peers: AnimusPeer[]
  ): Record<string, number>;

  /** Zero-config event inference from raw LLM text (12 signal patterns). */
  inferEvents(text: string): AnimusEvent[];

  /** Full diagnostic snapshot including velocity and noise. */
  diagnose(
    state: Record<string, number>,
    velocityState: Record<string, number>,
    noiseState: Record<string, number>,
    schema: AnimusSchema,
    nowMs: number
  ): AnimusDiagnostic;

  /** Parse [[event:intensity]] tags from text. */
  parseEvents(text: string): AnimusEvent[];

  /** Strip event tags from text. */
  stripEventTags(text: string): string;

  /** Circadian amplitude factor at a given time. */
  circadianFactor(nowMs: number, circ: AnimusSchema['circadian']): number;

  band(v: number, thresholds?: [number, number]): 'low' | 'mid' | 'high';
  band5(v: number): 'very_low' | 'low' | 'mid' | 'high' | 'very_high';
  clamp01(v: number): number;

  stateHash(state: Record<string, number>): number;
};

// ─── generatePersona re-export ────────────────────────────────────────────────

export declare function generatePersona(seed: number): AnimusSchema;
