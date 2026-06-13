/** 5 continuous trait dimensions drawn from the persona seed. Each is in [0, 1]. */
export interface PersonaTraits {
  /** Emotional set point: 0 = negative/pessimistic, 1 = positive/optimistic. */
  valence: number;
  /** Energy level and reactivity: 0 = lethargic, 1 = hyperactive. */
  arousal: number;
  /** Emotional inertia: 0 = volatile/reactive, 1 = resilient/stable. */
  stability: number;
  /** Warmth and social responsiveness: 0 = withdrawn, 1 = gregarious. */
  sociability: number;
  /** Focus and persistence: 0 = scattered, 1 = laser-focused. */
  drive: number;
}

export type VoiceRegister = 'direct' | 'vivid' | 'physiological' | 'social';

export type BandName = 'very_low' | 'low' | 'mid' | 'high' | 'very_high';

export type VariableName = 'mood' | 'energy' | 'curiosity' | 'affection' | 'focus';

/** Metadata stored in the generated schema under the `persona` key. */
export interface AnimusPersona {
  seed: number;
  traits: PersonaTraits;
  voice: VoiceRegister;
}

/** Partial AnimusSchema shape for the base parameter (full type lives in animus-sdk). */
export interface BaseSchema {
  name?: string;
  variables?: string[];
  baselines?: Record<string, number>;
  step_minutes?: number;
  events?: Record<string, Record<string, number>>;
  compiler?: { memory_injection?: boolean; [key: string]: unknown };
  [key: string]: unknown;
}

/** Complete schema output — compatible with `new Animus({ schema })` from animus-sdk. */
export interface GeneratedSchema {
  name?: string;
  variables: string[];
  baselines: Record<string, number>;
  homeostasis_rate: number;
  coupling: Record<string, Record<string, number>>;
  circadian: { peaks: string[]; floor: number; applies_to: string[] };
  noise: { magnitude: number; autocorrelation: number };
  event_sensitivity: Record<string, number>;
  triggers: Array<{ condition: string; fire: string; cooldown_steps: number }>;
  growth: {
    rules: Array<{ trigger: string; shifts: Record<string, number> }>;
  };
  compiler: {
    bands: Record<string, Record<BandName, string[]>>;
    memory_injection: boolean;
  };
  persona: AnimusPersona;
  step_minutes?: number;
  events?: Record<string, Record<string, number>>;
}

/**
 * Generate a full animus-sdk-compatible schema from a 32-bit integer seed.
 * Deterministic: same seed always returns an identical schema (Protocol v1).
 *
 * @param seed  — any integer; treated as unsigned 32-bit
 * @param base  — optional base schema; preserves name, variables, events, step_minutes
 */
export declare function generatePersona(seed: number, base?: BaseSchema): GeneratedSchema;

/**
 * Extract the 5 raw trait values from a seed without building a full schema.
 * Useful for comparing personalities or building custom parameter mappings.
 */
export declare function traitsFromSeed(seed: number): PersonaTraits;

/**
 * The full 2,000-phrase corpus used by generated schemas.
 * Shape: VOICE_REGISTERS[register][variable][band] → string[]
 */
export declare const VOICE_REGISTERS: Record<
  VoiceRegister,
  Record<VariableName, Record<BandName, string[]>>
>;
