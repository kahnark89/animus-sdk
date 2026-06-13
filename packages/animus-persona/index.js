'use strict';
const persona = require('./src/persona');

/**
 * Generate a full animus-sdk-compatible schema from a 32-bit integer seed.
 * Same seed always produces the same schema (deterministic, Protocol v1).
 *
 * @param {number} seed      — integer in [0, 2^32). Any integer is valid.
 * @param {object} [base]    — optional base schema to merge into (preserves name, variables, events)
 * @returns {object}         — complete AnimusSchema ready for `new Animus({ schema })`
 */
exports.generatePersona = persona.generatePersona;

/**
 * Extract the 5 raw trait values from a seed without building a full schema.
 * Useful for inspecting or comparing personalities.
 *
 * @param {number} seed
 * @returns {{ valence, arousal, stability, sociability, drive }}
 */
exports.traitsFromSeed = persona.traitsFromSeed;

/**
 * The full 2,000-phrase corpus: 4 registers × 5 variables × 5 bands × 20 phrases.
 * Useful for building custom compilers or inspecting generated vocabulary.
 *
 * Shape: VOICE_REGISTERS[register][variable][band] = string[]
 * Registers: 'direct' | 'vivid' | 'physiological' | 'social'
 * Bands: 'very_low' | 'low' | 'mid' | 'high' | 'very_high'
 */
exports.VOICE_REGISTERS = persona.VOICE_REGISTERS;
