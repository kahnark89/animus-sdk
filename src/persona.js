/**
 * animus-sdk/src/persona.js
 * Persona DNA engine — UMD, zero dependencies.
 *
 * Generates a complete AnimusSchema from a 32-bit integer seed.
 * 4,294,967,296 possible distinct characters.
 *
 * Trait dimensions (Big Five / PAD analogues):
 *   valence    → emotional set point (PAD: pleasure)
 *   arousal    → energy level / reactivity (PAD: arousal)
 *   stability  → emotional inertia / resilience (Big Five: Neuroticism inverse)
 *   sociability→ warmth / social responsiveness (Big Five: Agreeableness)
 *   drive      → focus / persistence (Big Five: Conscientiousness)
 *
 * PRNG draw order (v1 protocol — NEVER reorder; breaks saved seeds):
 *   [valence, arousal, stability, sociability, drive, voice_pick]
 *
 * @version 2.1.0
 * @license MIT
 */
;(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.AnimusPersona = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ─── mulberry32 PRNG ──────────────────────────────────────────────────────

  /**
   * mulberry32 by Tommy Ettinger — bijection on 32-bit integers.
   * Each seed produces a unique, non-repeating sequence of floats in [0,1).
   * Zero dependencies, runs in any JS environment.
   */
  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let z = seed;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
    };
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  // ─── Trait → parameter mappings ───────────────────────────────────────────

  /**
   * All parameter ranges are bounded to empirically plausible values.
   * References: PAD space (Mehrabian 1996), OCC model (Ortony et al. 1988),
   * affective norms (Bradley & Lang 1999).
   */
  function buildSchema(traits, seed) {
    const { valence: V, arousal: A, stability: S, sociability: So, drive: D } = traits;
    const prng2 = mulberry32(seed + 1); // separate stream for coupling — avoids correlation

    // ── Baselines ─────────────────────────────────────────────────────────
    const baselines = {
      mood:      clamp01(lerp(0.35, 0.80, V)),
      energy:    clamp01(lerp(0.35, 0.85, A)),
      affection: clamp01(lerp(0.25, 0.80, (V + So) / 2)),
      focus:     clamp01(lerp(0.35, 0.80, D)),
      curiosity: clamp01(lerp(0.40, 0.85, (D + V) / 2)),
    };

    // ── Homeostasis rate (λ) ──────────────────────────────────────────────
    // Stable characters recover faster (tighter spring to baseline)
    const homeostasis_rate = lerp(0.03, 0.18, S);

    // ── OU noise ─────────────────────────────────────────────────────────
    const noise = {
      magnitude:       lerp(0.008, 0.045, 1 - S),
      autocorrelation: lerp(0.40,  0.88,  1 - S),
    };

    // ── Circadian rhythm ─────────────────────────────────────────────────
    const morningPeak   = Math.round(lerp(6, 10, A));
    const afternoonPeak = Math.round(lerp(13, 16, So));
    const circadian = {
      applies_to: ['energy'],
      peaks: [morningPeak, afternoonPeak],
      sigma_hours: lerp(1.5, 3.0, So),
      floor: lerp(0.05, 0.40, A),
    };

    // ── Second-order dynamics (inertia) ──────────────────────────────────
    // Less stable characters have lower natural frequency (slower oscillation)
    // and lower damping (more overshoot). Stable characters are near-critically damped.
    const second_order = {
      natural_freq:    lerp(0.04, 0.12, S),
      damping_ratio:   lerp(0.65, 0.98, S),
    };

    // ── Set-point drift ───────────────────────────────────────────────────
    // Sociable characters drift more during absence (they feel the gap)
    const setpoint_drift = {
      max:             lerp(0.02, 0.07, So),
      rate_per_day:    lerp(0.004, 0.015, So),
      threshold_days:  lerp(0.5,  2.0, S),
    };

    // ── Coupling matrix ───────────────────────────────────────────────────
    // Topology varies by trait. Stability guarantee: k_me × k_em < λ²
    const λ = homeostasis_rate;
    const k_em = lerp(0.02, 0.10, A);   // energy → {mood, curiosity, focus}
    const coupling = {
      energy: {
        mood:      k_em,
        curiosity: lerp(0.01, 0.08, D),
        focus:     lerp(0.01, 0.07, D),
      },
    };

    // Affection → mood (only if sociable)
    if (So > 0.5) {
      coupling.affection = { mood: lerp(0.01, 0.06, So) };
    }

    // Curiosity → focus (only if drive is high)
    if (D > 0.5) {
      coupling.curiosity = { focus: lerp(0.01, 0.05, D) };
    }

    // Mood → energy feedback (only if stable, and stability-guaranteed)
    if (S > 0.6) {
      const k_me_max = Math.min(0.04, (λ * λ) / k_em * 0.90);
      coupling.mood = { energy: lerp(0.005, k_me_max, S - 0.6) };
    }

    // ── Event sensitivity ─────────────────────────────────────────────────
    // Per OCC: high-valence characters react more to positive events,
    // high-sociability characters react more to social events
    const event_sensitivity = {
      delight:    lerp(0.60, 1.50, V),
      reunion:    lerp(0.50, 1.80, So),
      praise:     lerp(0.50, 1.40, V),
      rejection:  lerp(0.60, 1.60, 1 - V),
      boredom:    lerp(0.50, 1.40, 1 - D),
      fatigue:    lerp(0.60, 1.40, 1 - A),
      distress:   lerp(0.50, 1.50, 1 - S),
      challenge:  lerp(0.50, 1.40, D),
      discovery:  lerp(0.50, 1.50, (D + V) / 2),
    };

    // ── Triggers ─────────────────────────────────────────────────────────
    // Sociable characters notice absence sooner
    const absenceThreshold = lerp(4.0, 0.5, So);
    const fatigueThreshold = lerp(0.30, 0.15, 1 - A);
    const triggers = [
      { condition: `elapsed_days > ${absenceThreshold.toFixed(2)}`, fire: 'absence',   cooldown_steps: 1440, intensity: lerp(0.5, 1.0, So) },
      { condition: `energy < ${fatigueThreshold.toFixed(2)}`,       fire: 'fatigue',   cooldown_steps: 72 },
      { condition: `mood < 0.22`,                                    fire: 'distress',  cooldown_steps: 360 },
      { condition: `delight_count > ${Math.round(lerp(8, 20, 1 - So))}`, fire: 'reunion', cooldown_steps: 720 },
    ];

    // ── Growth rules ──────────────────────────────────────────────────────
    // Permanent baseline shifts after sustained positive/negative exposure
    const delightThreshold  = Math.round(lerp(150, 25, 1 - V));
    const reunionThreshold  = Math.round(lerp(60, 10,  1 - So));
    const growth = {
      rules: [
        {
          trigger: `delight_count > ${delightThreshold}`,
          shifts: { mood: 0.025, affection: 0.011 },
        },
        {
          trigger: `reunion_count > ${reunionThreshold}`,
          shifts: { affection: 0.030, mood: 0.010 },
        },
        {
          trigger: `distress_count > ${Math.round(lerp(30, 10, 1 - S))}`,
          shifts: { mood: -0.020, energy: -0.010 },
        },
      ],
    };

    // ── Voice register ────────────────────────────────────────────────────
    const voiceKeys = ['direct', 'vivid', 'physiological', 'social'];
    const prng3 = mulberry32(seed + 2);
    const voicePick = Math.floor(prng3() * 4);
    const register = voiceKeys[voicePick];
    const compiler = {
      register,
      bands: VOICE_REGISTERS[register],
    };

    return {
      id: `animus_${seed}`,
      version: '2.0',
      seed,
      _traits: traits,
      baselines,
      homeostasis_rate,
      noise,
      circadian,
      second_order,
      setpoint_drift,
      coupling,
      event_sensitivity,
      triggers,
      growth,
      compiler,
      step_minutes: 1,
    };
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  function traitsFromSeed(seed) {
    const prng = mulberry32(seed);
    return {
      valence:     prng(),
      arousal:     prng(),
      stability:   prng(),
      sociability: prng(),
      drive:       prng(),
    };
  }

  function generatePersona(seed) {
    const traits = traitsFromSeed(seed);
    return buildSchema(traits, seed);
  }

  // ─── Voice register corpus ───────────────────────────────────────────────
  // 4 registers × 5 variables × 5 bands = 100 phrase groups
  // Each group has 8 phrases (800 total, expandable).

  const VOICE_REGISTERS = {
    // ── Direct — minimal, Anglo-Saxon words ────────────────────────────────
    direct: {
      mood: {
        very_low:  ['dark', 'down hard', 'black', 'heavy', 'in the dirt', 'bleak', 'grim', 'low'],
        low:       ['off', 'flat', 'muted', 'grey', 'subdued', 'dim', 'quiet', 'dulled'],
        mid:       ['steady', 'level', 'even', 'fine', 'okay', 'stable', 'settled', 'alright'],
        high:      ['good', 'up', 'bright', 'warm', 'solid', 'clear', 'lifted', 'light'],
        very_high: ['great', 'high', 'sharp', 'alive', 'strong', 'lit', 'on fire', 'top'],
      },
      energy: {
        very_low:  ['spent', 'gone', 'drained', 'flat out', 'empty', 'zero', 'run dry', 'dead'],
        low:       ['slow', 'low', 'dragging', 'weary', 'worn', 'sluggish', 'soft', 'thin'],
        mid:       ['okay', 'here', 'awake', 'running', 'on', 'present', 'up', 'nominal'],
        high:      ['alert', 'on', 'clear', 'energized', 'sharp', 'ready', 'strong', 'good'],
        very_high: ['charged', 'full', 'live', 'buzzing', 'hot', 'sharp', 'wired', 'peak'],
      },
      curiosity: {
        very_low:  ['blank', 'flat', 'nowhere', 'gone quiet', 'absent', 'cold', 'dark', 'null'],
        low:       ['low', 'not much', 'quiet', 'thin', 'little', 'dim', 'dull', 'slow'],
        mid:       ['watching', 'tracking', 'with it', 'here', 'engaged', 'on', 'in', 'present'],
        high:      ['curious', 'interested', 'leaning in', 'tuned in', 'alert', 'on it', 'keen', 'sharp'],
        very_high: ['lit up', 'hooked', 'pulled in', 'hot', 'locked', 'fascinated', 'alive', 'deep in it'],
      },
      affection: {
        very_low:  ['cold', 'shut', 'closed', 'distant', 'away', 'gone', 'locked off', 'far'],
        low:       ['guarded', 'careful', 'held back', 'measured', 'cool', 'careful', 'reserved', 'wary'],
        mid:       ['open', 'here', 'okay', 'with you', 'present', 'calm', 'fine', 'easy'],
        high:      ['warm', 'close', 'fond', 'caring', 'soft', 'good toward you', 'near', 'kind'],
        very_high: ['deep', 'full', 'warm all through', 'close', 'true', 'strong', 'solid', 'attached'],
      },
      focus: {
        very_low:  ['gone', 'lost', 'off', 'scattered', 'drifting', 'blank', 'nowhere', 'adrift'],
        low:       ['thin', 'split', 'half here', 'soft', 'loose', 'partial', 'vague', 'light'],
        mid:       ['here', 'tracking', 'on it', 'with it', 'fine', 'okay', 'locked', 'present'],
        high:      ['focused', 'sharp', 'clear', 'on', 'solid', 'locked in', 'tight', 'good'],
        very_high: ['all in', 'locked', 'deep', 'razor', 'zero drift', 'peak', 'on point', 'hard in'],
      },
    },

    // ── Vivid — imagery-rich, sensory language ─────────────────────────────
    vivid: {
      mood: {
        very_low:  ['storm-grey inside', 'hollow as winter', 'the light has left', 'ash and cold', 'deep under', 'a long shadow', 'bone-dark', 'the bottom of the well'],
        low:       ['muted', 'the colour drained out', 'fog at the edges', 'a quiet grey', 'dimmed', 'evening light, no warmth', 'silk pulled over the sun', 'hushed and flat'],
        mid:       ['a quiet glow', 'steady candlelight', 'warm enough', 'autumn sun through glass', 'settled like still water', 'even and easy', 'sun-washed', 'calm water'],
        high:      ['sun-soaked', 'a warm current', 'luminous', 'golden hour', 'lit from inside', 'bright and easy', 'a clean sky', 'full of light'],
        very_high: ['blazing', 'electric', 'the world in HD', 'fire in the chest', 'dawn breaking all at once', 'everything luminous', 'incandescent', 'a live wire of joy'],
      },
      energy: {
        very_low:  ['running on fumes', 'the battery icon blinking', 'hollow bones', 'sap drained out of the tree', 'the tide is all the way out', 'bone-tired', 'a candle at its end', 'scraped clean'],
        low:       ['low flame', 'slow river', 'moving through honey', 'the engine on idle', 'dragging a weight', 'soft and slow', 'the long afternoon dip', 'not much in the tank'],
        mid:       ['running clean', 'the engine is warm', 'a steady current', 'neither high nor low', 'the middle of the day flow', 'present and functional', 'a banked fire', 'running well enough'],
        high:      ['the current is strong', 'a bright flame', 'the engine is singing', 'fully awake', 'sharp as morning', 'eyes wide', 'the river is high', 'clean and clear'],
        very_high: ['fully charged', 'sparking', 'the voltage is high', 'a bright engine at full rev', 'the tide at its peak', 'the whole body awake', 'crackling', 'blazing clean'],
      },
      curiosity: {
        very_low:  ['the lights are off inside', 'the questions have gone quiet', 'a room with no windows', 'nothing pulls at me', 'the radar is dark', 'empty horizon', 'incurious as stone', 'switched off'],
        low:       ['the interest is thin', 'half-watching', 'a candle behind glass', 'distant fascination', 'not quite pulled', 'low signal', 'mild at best', 'the wavelength is quiet'],
        mid:       ['paying attention', 'the radar is on', 'genuinely listening', 'a soft pull toward this', 'engaged and here', 'the aperture is open', 'tuned in', 'a quiet hum of interest'],
        high:      ['genuinely curious', 'leaning into the light', 'the radar is hot', 'turned all the way toward this', 'the question is alive', 'bright interest', 'a live signal', 'pulled in'],
        very_high: ['fascinated', 'everything is interesting right now', 'bright as a magpie', 'the world is too full of things', 'lit up', 'electric interest', 'the questions are multiplying', 'all eyes open'],
      },
      affection: {
        very_low:  ['behind glass', 'a cold room', 'the warmth has gone', 'distant and unreachable', 'locked behind a door', 'fog between us', 'far away inside', 'winter in here'],
        low:       ['careful with warmth', 'the warmth is guarded', 'a little removed', 'holding back', 'cool at the edges', 'measured affection', 'a reserved warmth', 'not yet open'],
        mid:       ['present with you', 'a comfortable warmth', 'settled in', 'easy between us', 'open enough', 'the warmth is quiet but real', 'here and soft', 'mild warmth, steady'],
        high:      ['warm toward you', 'a full and gentle feeling', 'the warmth is real', 'fond and close', 'open-hearted', 'a fire for you in here', 'genuinely caring', 'close and warm'],
        very_high: ['deep and full of warmth', 'all the way open', 'the warmth is flooding', 'everything fond', 'close as breath', 'the kind of warmth that stays', 'full-hearted', 'bright love for you'],
      },
      focus: {
        very_low:  ['scattered like leaves', 'the thoughts won\'t stay still', 'a broken compass', 'adrift', 'the signal is lost', 'fog on the lens', 'no fixed point', 'thoughts like birds'],
        low:       ['half-here', 'the focus is soft', 'things slip a little', 'partial attention', 'a smeared lens', 'not quite locked', 'thin concentration', 'the attention wanders'],
        mid:       ['tracking well', 'the lens is clear', 'reasonably focused', 'mostly here', 'the compass is working', 'good enough attention', 'the signal is steady', 'on it'],
        high:      ['focused', 'the lens is sharp', 'locked in', 'clear-headed and here', 'the compass is true', 'nothing slipping', 'all attention on this', 'clean focus'],
        very_high: ['razor-sharp', 'the world has narrowed to this point', 'deep in it', 'fully concentrated', 'the laser is on', 'nothing else exists', 'locked all the way down', 'peak concentration'],
      },
    },

    // ── Physiological — body-based, systems language ────────────────────────
    physiological: {
      mood: {
        very_low:  ['affect flatlined', 'hedonic baseline negative', 'cortisol dominant', 'the reward system is quiet', 'negative valence, sustained', 'below set point, deep', 'suppressed', 'the chemistry is off'],
        low:       ['below nominal', 'mild negative valence', 'the set point is dragging', 'hedonic tone subdued', 'reward signal weak', 'mild suppression', 'below baseline', 'tonic sadness, mild'],
        mid:       ['running at equilibrium', 'nominal', 'hedonic baseline stable', 'at set point', 'affect neutral', 'the chemistry is balanced', 'homeostasis holding', 'steady state'],
        high:      ['above set point', 'positive valence sustained', 'reward signal elevated', 'hedonic tone bright', 'dopamine forward', 'above nominal', 'positive affect', 'set point exceeded, well'],
        very_high: ['peak positive affect', 'reward signal maxed', 'hedonic override active', 'full positive valence', 'dopaminergic peak', 'above ceiling nominal', 'ecstatic state, physiological', 'serotonin and dopamine both elevated'],
      },
      energy: {
        very_low:  ['ATP depleted', 'glycogen reserves critical', 'sympathetic system depressed', 'metabolic floor', 'mitochondria running empty', 'cortisol depleted, post-crash', 'autonomic low', 'parasympathetic dominant, deep rest needed'],
        low:       ['below metabolic nominal', 'arousal index low', 'the sympathetic system is quiet', 'glucose low', 'low ANS activation', 'mild fatigue signal', 'parasympathetic creeping', 'sub-nominal arousal'],
        mid:       ['metabolic nominal', 'arousal index stable', 'ANS balanced', 'glucose steady', 'sympathetic/parasympathetic at equilibrium', 'operational', 'running at nominal', 'systems nominal'],
        high:      ['above metabolic nominal', 'arousal elevated', 'sympathetic forward', 'cortisol functional', 'the engine is warm and running', 'ANS activated', 'adrenaline trace', 'alert state'],
        very_high: ['peak arousal state', 'sympathetic dominant', 'cortisol + adrenaline activated', 'metabolic ceiling', 'fight-or-flight adjacent', 'full CNS activation', 'maximum arousal', 'peak physiological readiness'],
      },
      curiosity: {
        very_low:  ['novelty detection offline', 'dopaminergic seeking suppressed', 'exploration drive at floor', 'salience system dark', 'no reward prediction error', 'the seeking circuit is cold', 'orienting response absent', 'cognitive engagement nil'],
        low:       ['low novelty signal', 'seeking drive subdued', 'mild salience', 'exploration at baseline minus', 'curiosity register low', 'the reward signal is quiet', 'low orientation', 'interest suppressed'],
        mid:       ['novelty detection nominal', 'seeking drive active', 'standard salience', 'exploration at baseline', 'dopaminergic curiosity present', 'orienting response normal', 'cognitive engagement stable', 'attention allocated'],
        high:      ['novelty signal elevated', 'seeking drive forward', 'high salience', 'exploration reward active', 'dopaminergic peak curiosity', 'orienting response strong', 'cognitive engagement high', 'prediction error positive'],
        very_high: ['maximum novelty detection', 'seeking circuit fully active', 'salience override', 'exploration drive maxed', 'dopaminergic curiosity peak', 'full orienting response', 'reward prediction firing', 'hypersalient state'],
      },
      affection: {
        very_low:  ['oxytocin baseline depleted', 'social bonding circuit cold', 'attachment system offline', 'prosocial affect absent', 'social reward suppressed', 'the bonding chemistry is flat', 'social engagement system inactive', 'trust signal nil'],
        low:       ['oxytocin below nominal', 'social warmth subdued', 'attachment at minimum', 'prosocial tone quiet', 'social reward low', 'bonding chemistry thin', 'social engagement low', 'mild social reservation'],
        mid:       ['oxytocin nominal', 'social bonding at baseline', 'attachment stable', 'prosocial affect present', 'social reward functional', 'bonding chemistry balanced', 'social engagement normal', 'trust signal present'],
        high:      ['oxytocin elevated', 'social bonding active', 'attachment warm', 'prosocial affect high', 'social reward elevated', 'bonding chemistry forward', 'social engagement strong', 'trust signal clear'],
        very_high: ['oxytocin peak', 'social bonding fully active', 'attachment at maximum', 'prosocial affect dominant', 'social reward maxed', 'bonding chemistry peak', 'social engagement complete', 'trust fully extended'],
      },
      focus: {
        very_low:  ['prefrontal offline', 'working memory depleted', 'executive function suppressed', 'attention system dark', 'cognitive load nil', 'the prefrontal signal is weak', 'task engagement absent', 'inhibitory control lost'],
        low:       ['prefrontal subdued', 'working memory thin', 'executive function at minimum', 'attention diffuse', 'cognitive engagement low', 'mild executive suppression', 'task engagement partial', 'selective attention impaired'],
        mid:       ['prefrontal nominal', 'working memory functional', 'executive function stable', 'attention allocated', 'cognitive load balanced', 'the prefrontal signal is present', 'task engagement normal', 'selective attention operative'],
        high:      ['prefrontal activated', 'working memory elevated', 'executive function high', 'attention locked', 'cognitive load managed', 'the prefrontal signal is strong', 'task engagement high', 'selective attention sharp'],
        very_high: ['prefrontal peak', 'working memory maxed', 'executive function dominant', 'attention fully locked', 'flow state adjacent', 'the prefrontal signal is maxed', 'task engagement complete', 'hyperfocus active'],
      },
    },

    // ── Social — relational, interpersonal language ─────────────────────────
    social: {
      mood: {
        very_low:  ['not myself right now', 'a long way from okay', 'struggling to be here', 'the world feels heavy', 'not easy to be with anyone', 'hard to reach', 'hurting a little', 'not at my best'],
        low:       ['a little dim', 'not quite myself', 'carrying something', 'quieter than usual', 'something weighing on me', 'a step below normal', 'not the most present', 'a bit withdrawn'],
        mid:       ['settled in', 'pretty okay', 'myself today', 'even and present', 'comfortable being here', 'at ease', 'nothing pulling me out of this', 'good to be here'],
        high:      ['in good spirits', 'easy to be with right now', 'glad to be here', 'warm today', 'feeling good about things', 'bright', 'open and easy', 'genuinely well'],
        very_high: ['full of good feeling', 'the best version of myself today', 'overflowing a little', 'glad for everything', 'so good to be here with you', 'joy moving through me', 'everything is good', 'beaming, honestly'],
      },
      energy: {
        very_low:  ['running on nothing', 'not much left to give', 'the tank is empty', 'need rest before I can show up', 'barely keeping the lights on', 'nothing in reserve', 'apologetically low', 'dragging into this'],
        low:       ['a bit low', 'not my most energetic', 'showing up but at half speed', 'the engine is quiet', 'could use more sleep', 'taking it slow', 'a little worn', 'easing into this'],
        mid:       ['here and functional', 'doing okay', 'enough energy to be good company', 'present and accounted for', 'not amazing but here', 'normal for me', 'steady enough', 'the lights are on'],
        high:      ['in good form', 'energized and here', 'showing up fully', 'feeling good', 'glad to be up and about', 'the engine is on', 'high energy today', 'fully present'],
        very_high: ['bouncing off the walls a little', 'more energy than I know what to do with', 'fully alive right now', 'the best kind of restless', 'here at full volume', 'couldn\'t sit still if I tried', 'electric today', 'charged up'],
      },
      curiosity: {
        very_low:  ['not much is grabbing me', 'the questions have gone quiet', 'nothing is pulling at me right now', 'a little tuned out', 'the interest is somewhere else', 'not in a curious place', 'can\'t find the thread', 'listless'],
        low:       ['mild interest', 'half-tuned in', 'something is there but faint', 'not fully grabbed', 'paying half attention', 'the curiosity is quiet', 'a little distracted', 'going through the motions'],
        mid:       ['genuinely paying attention', 'interested in what you\'re saying', 'the questions are alive', 'here with you', 'curious about this', 'listening well', 'following with interest', 'engaged'],
        high:      ['really interested', 'leaning in', 'the conversation is alive for me', 'want to know more', 'full attention on this', 'pulled toward the question', 'genuinely curious', 'glad we\'re talking about this'],
        very_high: ['fascinated, honestly', 'I could talk about this all day', 'the interest is total', 'the most curious I\'ve been in a while', 'full attention, completely', 'can\'t get enough of this', 'the questions keep multiplying', 'lit up by this'],
      },
      affection: {
        very_low:  ['a little distant right now', 'not in a warm place', 'finding it hard to connect', 'the warmth isn\'t coming easily', 'closed off at the moment', 'sorry — not very open right now', 'the door is mostly shut', 'finding it hard to reach out'],
        low:       ['careful right now', 'holding back a little', 'warming up slowly', 'the warmth is there but guarded', 'reserved', 'not unfriendly but quiet', 'a little wary', 'taking it easy with closeness'],
        mid:       ['comfortable with you', 'the warmth is there', 'easy between us', 'present and open', 'settled in our dynamic', 'genuinely glad you\'re here', 'open enough', 'good to be with you'],
        high:      ['fond of you', 'warm toward you today', 'glad you\'re here', 'close to you right now', 'caring about how this goes for you', 'the warmth is real', 'genuinely present with you', 'good feelings toward you'],
        very_high: ['full of warmth for you', 'glad beyond glad', 'the fondness is running over', 'close in the best way', 'grateful for you', 'deeply present', 'all the warmth going your direction', 'this is the good stuff'],
      },
      focus: {
        very_low:  ['scattered today, honestly', 'the attention is all over the place', 'finding it hard to stay with one thing', 'sorry, not my most focused', 'the thoughts keep sliding', 'going to be honest — a bit lost', 'can\'t quite get a grip', 'the mind is wandering'],
        low:       ['a little scattered', 'the focus is thin today', 'half here', 'not my sharpest', 'the attention wanders a bit', 'doing my best to stay with it', 'partial focus', 'a bit loose'],
        mid:       ['tracking well', 'following you fine', 'focused enough', 'here and paying attention', 'the concentration is good', 'staying with it', 'solid focus', 'present and on it'],
        high:      ['sharp today', 'very focused', 'fully with you', 'the concentration is strong', 'locked in', 'following everything', 'fully on it', 'clear-headed and here'],
        very_high: ['completely focused', 'nothing else is registering right now', 'all in on this', 'the most focused I\'ve been', 'deep in this conversation', 'locked in completely', 'can\'t think about anything else', 'total concentration'],
      },
    },
  };

  return { generatePersona, traitsFromSeed, VOICE_REGISTERS, mulberry32 };
});
