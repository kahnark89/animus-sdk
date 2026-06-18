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
 * @version 2.1.3
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
  // Each group has 20 phrases (2,000 total).

  const VOICE_REGISTERS = {
    // ── Direct — minimal, Anglo-Saxon words ────────────────────────────────
    direct: {
      mood: {
        very_low:  ['dark', 'down hard', 'black', 'heavy', 'in the dirt', 'bleak', 'grim', 'low', 'crushed', 'sunken', 'broken', 'gone under', 'rock bottom', 'in the hole', 'deep down', 'hollow', 'worn through', 'not okay', 'bad place', 'the worst'],
        low:       ['off', 'flat', 'muted', 'grey', 'subdued', 'dim', 'quiet', 'dulled', 'below', 'faded', 'dull', 'not great', 'slow', 'soft', 'thin', 'not much', 'a bit off', 'below par', 'dragged down', 'low-grade sad'],
        mid:       ['steady', 'level', 'even', 'fine', 'okay', 'stable', 'settled', 'alright', 'fair', 'decent', 'normal', 'neutral', 'balanced', 'holding', 'middle', 'not bad', 'passable', 'good enough', 'on track', 'average'],
        high:      ['good', 'up', 'bright', 'warm', 'solid', 'clear', 'lifted', 'light', 'well', 'strong', 'positive', 'better', 'above', 'upbeat', 'sound', 'happy', 'glad', 'cheerful', 'on the up', 'open'],
        very_high: ['great', 'high', 'sharp', 'alive', 'strong', 'lit', 'on fire', 'top', 'peak', 'best', 'electric', 'charged', 'brilliant', 'soaring', 'blazing', 'superb', 'exultant', 'full', 'pure high', 'perfect'],
      },
      energy: {
        very_low:  ['spent', 'gone', 'drained', 'flat out', 'empty', 'zero', 'run dry', 'dead', 'wrecked', 'nothing left', 'bottomed out', 'wiped', 'done', 'tank dry', 'out cold', 'total flat', 'dust', 'finished', 'hollow', 'all gone'],
        low:       ['slow', 'low', 'dragging', 'weary', 'worn', 'sluggish', 'soft', 'thin', 'tired', 'heavy', 'drooping', 'not much', 'half speed', 'mild drag', 'not full', 'dim', 'under', 'below', 'fading', 'behind'],
        mid:       ['okay', 'here', 'awake', 'running', 'on', 'present', 'up', 'nominal', 'fine', 'decent', 'normal', 'stable', 'even', 'steady', 'functional', 'working', 'mid-level', 'enough', 'ticking', 'going'],
        high:      ['alert', 'on', 'clear', 'energized', 'sharp', 'ready', 'strong', 'good', 'active', 'bright', 'alive', 'quick', 'fired up', 'keen', 'charged', 'brisk', 'lively', 'solid', 'swift', 'positive'],
        very_high: ['charged', 'full', 'live', 'buzzing', 'hot', 'sharp', 'wired', 'peak', 'electric', 'blazing', 'max', 'full tilt', 'surging', 'powered', 'high voltage', 'cranked', 'revved', 'blasting', 'overdrive', 'overloaded'],
      },
      curiosity: {
        very_low:  ['blank', 'flat', 'nowhere', 'gone quiet', 'absent', 'cold', 'dark', 'null', 'dead still', 'empty', 'nothing there', 'hollow', 'switched off', 'no signal', 'silent', 'no pull', 'gone', 'off', 'not there', 'closed'],
        low:       ['low', 'not much', 'quiet', 'thin', 'little', 'dim', 'dull', 'slow', 'mild', 'faint', 'weak', 'not strong', 'minor', 'below', 'subdued', 'soft', 'barely there', 'low key', 'muted', 'sparse'],
        mid:       ['watching', 'tracking', 'with it', 'here', 'engaged', 'on', 'in', 'present', 'paying attention', 'noted', 'tuned', 'aware', 'catching', 'mild interest', 'following', 'alert', 'taking in', 'live', 'noticing', 'attentive'],
        high:      ['curious', 'interested', 'leaning in', 'tuned in', 'alert', 'on it', 'keen', 'sharp', 'pulled', 'engaged fully', 'looking closer', 'drawn in', 'bright', 'asking', 'questioning', 'probing', 'wide awake', 'seeking', 'gripped', 'hooked in'],
        very_high: ['lit up', 'hooked', 'pulled in', 'hot', 'locked', 'fascinated', 'alive', 'deep in it', 'all in', 'burning bright', 'total pull', 'deep dive', 'maximum interest', 'full lock', 'obsessed', 'electric', 'consumed', 'laser in', 'on fire for it', 'zero-out everything else'],
      },
      affection: {
        very_low:  ['cold', 'shut', 'closed', 'distant', 'away', 'gone', 'locked off', 'far', 'cut off', 'frozen', 'walled', 'iced', 'sealed', 'remote', 'hard closed', 'not there', 'blank wall', 'refused', 'stone', 'sealed off'],
        low:       ['guarded', 'careful', 'held back', 'measured', 'cool', 'restrained', 'reserved', 'wary', 'tentative', 'cautious', 'slow to open', 'not warm', 'pulled back', 'half-closed', 'minimal', 'tight', 'low warmth', 'not ready', 'arms crossed', 'not free'],
        mid:       ['open', 'here', 'okay', 'with you', 'present', 'calm', 'fine', 'easy', 'comfortable', 'mild warmth', 'nothing wrong', 'approachable', 'steady', 'not far', 'decent', 'willing', 'clear', 'honest', 'neutral to warm', 'okay toward you'],
        high:      ['warm', 'close', 'fond', 'caring', 'soft', 'good toward you', 'near', 'kind', 'friendly', 'strong warmth', 'reaching', 'bonded', 'close to you', 'tender', 'affectionate', 'open-hearted', 'liking you', 'engaged with you', 'like you a lot', 'feeling good toward you'],
        very_high: ['deep', 'full', 'warm all through', 'close', 'true', 'strong', 'solid', 'attached', 'devoted', 'bonded fully', 'all the way in', 'full warmth', 'love you', 'deep care', 'complete', 'whole', 'total attachment', 'warm through and through', 'nothing held back', 'fully yours'],
      },
      focus: {
        very_low:  ['gone', 'lost', 'off', 'scattered', 'drifting', 'blank', 'nowhere', 'adrift', 'totally lost', 'all over', 'unfocused', 'absent', 'not here', 'disconnected', 'shattered', 'broken up', 'dispersed', 'pulled apart', 'mind gone', 'no grip'],
        low:       ['thin', 'split', 'half here', 'soft', 'loose', 'partial', 'vague', 'light', 'not sharp', 'drifting a bit', 'weakly on', 'not locked', 'mild fog', 'below focus', 'sliding', 'reduced', 'low lock', 'barely on', 'partial only', 'drifting'],
        mid:       ['here', 'tracking', 'on it', 'with it', 'fine', 'okay', 'locked', 'present', 'working', 'decent', 'following', 'stable lock', 'good enough', 'holding', 'attending', 'mid-focus', 'on task', 'engaged enough', 'doing it', 'reasonable focus'],
        high:      ['focused', 'sharp', 'clear', 'on', 'solid', 'locked in', 'tight', 'good', 'no slip', 'full on', 'precise', 'total attention', 'no distractions', 'hard focus', 'clean', 'intent', 'all here', 'driving', 'dialed', 'strong lock'],
        very_high: ['all in', 'locked', 'deep', 'razor', 'zero drift', 'peak', 'on point', 'hard in', 'total', 'absolute lock', 'tunnel', 'full depth', 'maximum focus', 'nothing else', 'one-track', 'total absorption', 'in the zone', 'overwhelming concentration', 'cannot break', 'deep deep in'],
      },
    },

    // ── Vivid — imagery-rich, sensory language ─────────────────────────────
    vivid: {
      mood: {
        very_low:  ['storm-grey inside', 'hollow as winter', 'the light has left', 'ash and cold', 'deep under', 'a long shadow', 'bone-dark', 'the bottom of the well', 'the colour has died', 'winter lodged inside', 'like walking through cold smoke', 'a long night with no dawn', 'lost in the fog', 'the fire went out', 'grey all the way down', 'buried under it', 'not one candle left', 'a dark quiet', 'the sun will not come', 'a cold and empty room'],
        low:       ['muted', 'the colour drained out', 'fog at the edges', 'a quiet grey', 'dimmed', 'evening light no warmth', 'silk pulled over the sun', 'hushed and flat', 'the warmth turned down', 'a thin winter light', 'the colour is faded', 'overcast and still', 'the embers low', 'a clouded sky', 'pale and quiet', 'light behind gauze', 'half-lit', 'subdued like a grey afternoon', 'soft and fading', 'not quite dark but dim'],
        mid:       ['a quiet glow', 'steady candlelight', 'warm enough', 'autumn sun through glass', 'settled like still water', 'even and easy', 'sun-washed', 'calm water', 'an ordinary afternoon of sunshine', 'soft light that holds', 'the day is turning out okay', 'a comfortable warmth', 'neither bright nor dark', 'steady flame', 'warm and unremarkable', 'gently lit', 'a pleasant average', 'golden enough', 'the usual gentle hum', 'the kind of day you don\'t notice'],
        high:      ['sun-soaked', 'a warm current', 'luminous', 'golden hour', 'lit from inside', 'bright and easy', 'a clean sky', 'full of light', 'radiant', 'a bright morning feeling', 'warmth all the way down', 'a good clean light', 'like sun off water', 'the sky opened', 'bright inside', 'genuinely warm', 'happy light', 'a high warm glow', 'flooding with gold', 'beautiful from the inside'],
        very_high: ['blazing', 'electric', 'the world in HD', 'fire in the chest', 'dawn breaking all at once', 'everything luminous', 'incandescent', 'a live wire of joy', 'blazing with it', 'every colour brighter', 'the world too beautiful', 'unstoppable brightness', 'lit from everywhere', 'burning clean', 'pure radiance', 'joy like a flood', 'dazzling', 'brilliant and full', 'too bright to contain', 'ecstatic light'],
      },
      energy: {
        very_low:  ['running on fumes', 'the battery icon blinking', 'hollow bones', 'sap drained out of the tree', 'the tide is all the way out', 'bone-tired', 'a candle at its end', 'scraped clean', 'the engine has stopped', 'the well is dry', 'emptied out completely', 'fuel run to nothing', 'not even fumes now', 'the lights are going out', 'running on memory of energy', 'the tide withdrew and stayed out', 'down to the wick', 'all of it spent', 'nothing left in the machine', 'a cold hearth'],
        low:       ['low flame', 'slow river', 'moving through honey', 'the engine on idle', 'dragging a weight', 'soft and slow', 'the long afternoon dip', 'not much in the tank', 'the fire is banked low', 'the current is slow', 'only just enough', 'a sluggish stream', 'still turning but barely', 'the energy is thin', 'a low warm fire', 'moving without urgency', 'the engine hums but doesn\'t race', 'the flame is small', 'the day has gotten heavy', 'slow water'],
        mid:       ['running clean', 'the engine is warm', 'a steady current', 'neither high nor low', 'the middle of the day flow', 'present and functional', 'a banked fire', 'running well enough', 'the engine is on and steady', 'functional and here', 'neither racing nor stopped', 'a useful hum', 'the current flows without drama', 'doing its job', 'the machine is running', 'a regular burn', 'present and working', 'the fire is doing what it should', 'even and sustained', 'ordinary good running'],
        high:      ['the current is strong', 'a bright flame', 'the engine is singing', 'fully awake', 'sharp as morning', 'eyes wide', 'the river is high', 'clean and clear', 'the fire is bright', 'the engine is racing well', 'the current runs fast', 'fully powered', 'the tide is in and rising', 'everything working', 'alive and running', 'a strong even flame', 'the engine on the good side of full', 'the whole system awake', 'surging well', 'strong and bright'],
        very_high: ['fully charged', 'sparking', 'the voltage is high', 'a bright engine at full rev', 'the tide at its peak', 'the whole body awake', 'crackling', 'blazing clean', 'the engine is screaming right', 'the power is maxed', 'electric and unstoppable', 'the river is flooding in the best way', 'the voltage is through the ceiling', 'running at the redline', 'all systems blazing', 'the current is a flood', 'crackling with it', 'the tide has never been higher', 'pure charged force', 'blazing and boundless'],
      },
      curiosity: {
        very_low:  ['the lights are off inside', 'the questions have gone quiet', 'a room with no windows', 'nothing pulls at me', 'the radar is dark', 'empty horizon', 'incurious as stone', 'switched off', 'nothing here is interesting', 'the lantern has gone out', 'looking and seeing nothing new', 'the world has gone flat', 'no hook', 'nothing catches', 'all of it familiar and dull', 'not a single question forming', 'the interest has dried up', 'the wondering has stopped', 'eyes open but not seeing', 'the spark is gone'],
        low:       ['the interest is thin', 'half-watching', 'a candle behind glass', 'distant fascination', 'not quite pulled', 'low signal', 'mild at best', 'the wavelength is quiet', 'a faint pull', 'something flickers but doesn\'t catch', 'barely interested', 'watching from a distance', 'the hook is weak', 'the question is soft', 'mild attention', 'the curiosity is there but small', 'the signal is weak', 'a little distant', 'not fully here for it', 'faint stirring only'],
        mid:       ['paying attention', 'the radar is on', 'genuinely listening', 'a soft pull toward this', 'engaged and here', 'the aperture is open', 'tuned in', 'a quiet hum of interest', 'present for it', 'the questions are forming', 'interested enough to stay', 'following along with real attention', 'the curiosity is live', 'a gentle interest', 'here for this', 'tracking with mild pleasure', 'questions beginning to arise', 'the interest is real', 'engaged by it', 'open and attentive'],
        high:      ['genuinely curious', 'leaning into the light', 'the radar is hot', 'turned all the way toward this', 'the question is alive', 'bright interest', 'a live signal', 'pulled in', 'the fascination is real', 'the questions won\'t stop forming', 'drawn in close', 'the light is coming from this direction', 'bright and focused', 'the interest is genuine', 'everything pulls toward this', 'the hook is in', 'the antenna is hot', 'leaning all the way in', 'the radar is singing', 'captured by this'],
        very_high: ['fascinated', 'everything is interesting right now', 'bright as a magpie', 'the world is too full of things', 'lit up', 'electric interest', 'the questions are multiplying', 'all eyes open', 'the fascination has taken over', 'interest as a physical force', 'the hook is all the way in', 'nothing else matters but this', 'the questions keep spawning more questions', 'the radar is overloaded', 'consumed by this', 'dazzled by it all', 'the curiosity is a fire', 'all the lights are on', 'the aperture is blown open', 'hopelessly hooked'],
      },
      affection: {
        very_low:  ['behind glass', 'a cold room', 'the warmth has gone', 'distant and unreachable', 'locked behind a door', 'fog between us', 'far away inside', 'winter in here', 'a room with no heat', 'the warmth has drained away', 'sealed off', 'cold and closed', 'no fire here', 'the distance is real', 'the door is shut', 'nothing between us but cold air', 'the warmth never made it through', 'ice at the threshold', 'all the warmth has retreated', 'the coldest interior'],
        low:       ['careful with warmth', 'the warmth is guarded', 'a little removed', 'holding back', 'cool at the edges', 'measured affection', 'a reserved warmth', 'not yet open', 'keeping some warmth in reserve', 'the warmth is present but small', 'slightly at a distance', 'a cool caution', 'not unfriendly but not close', 'holding the warmth back', 'a guarded approach', 'a door left mostly shut', 'measured and cautious', 'the warmth is qualified', 'careful not to overflow', 'cordial but cool'],
        mid:       ['present with you', 'a comfortable warmth', 'settled in', 'easy between us', 'open enough', 'the warmth is quiet but real', 'here and soft', 'mild warmth steady', 'the warmth is unremarkable but genuine', 'neither far nor close', 'comfortable and present', 'a pleasant ease', 'the warmth is ordinary and okay', 'close enough', 'the door is open', 'a modest warmth', 'here with you easily', 'a calm closeness', 'nothing difficult', 'a steady mild warmth'],
        high:      ['warm toward you', 'a full and gentle feeling', 'the warmth is real', 'fond and close', 'open-hearted', 'a fire for you in here', 'genuinely caring', 'close and warm', 'the warmth is coming from a real place', 'drawn toward you', 'the care is genuine', 'the closeness feels right', 'a bright affection', 'the warmth is running', 'fond to a high degree', 'openly caring', 'the warmth is high and real', 'tender and close', 'the care shows', 'full of feeling for you'],
        very_high: ['deep and full of warmth', 'all the way open', 'the warmth is flooding', 'everything fond', 'close as breath', 'the kind of warmth that stays', 'full-hearted', 'bright love for you', 'the warmth is overwhelming', 'nothing held back', 'the fondness has no ceiling', 'love moving through', 'all warmth all the way', 'the care is total', 'completely open', 'the warmth is the whole atmosphere', 'flooded with feeling for you', 'as close as it gets', 'the fondness is a tide', 'love full and unguarded'],
      },
      focus: {
        very_low:  ['scattered like leaves', 'the thoughts won\'t stay still', 'a broken compass', 'adrift', 'the signal is lost', 'fog on the lens', 'no fixed point', 'thoughts like birds', 'the attention has shattered', 'the lens is cracked and scattered', 'the compass is spinning', 'fog everywhere', 'no thread to hold', 'the thoughts keep slipping', 'adrift without anchor', 'the mind is a loose kite', 'nothing to hold to', 'shattered concentration', 'the signal has broken up', 'no north at all'],
        low:       ['half-here', 'the focus is soft', 'things slip a little', 'partial attention', 'a smeared lens', 'not quite locked', 'thin concentration', 'the attention wanders', 'the compass wobbles', 'a hazy signal', 'the lens is smudged', 'attention wandering at the edges', 'nothing fully held', 'the focus is porous', 'the thoughts drift', 'a soft and imprecise attention', 'the lock is weak', 'the compass is approximate', 'thinly attending', 'the signal fades in and out'],
        mid:       ['tracking well', 'the lens is clear', 'reasonably focused', 'mostly here', 'the compass is working', 'good enough attention', 'the signal is steady', 'on it', 'the focus holds', 'the lens is serviceable', 'tracking without difficulty', 'attention is working', 'on task and holding', 'the signal comes through', 'following without effort', 'reasonably sharp', 'no major drift', 'the lock is decent', 'working well', 'the compass points true enough'],
        high:      ['focused', 'the lens is sharp', 'locked in', 'clear-headed and here', 'the compass is true', 'nothing slipping', 'all attention on this', 'clean focus', 'the lens is crystalline', 'locked with precision', 'the signal is bright and clear', 'the compass is exact', 'all here', 'tight focus', 'everything held', 'attention at its sharpest', 'nothing escaping the focus', 'the lock is solid', 'clear and exact', 'the signal is strong and unmixed'],
        very_high: ['razor-sharp', 'the world has narrowed to this point', 'deep in it', 'fully concentrated', 'the laser is on', 'nothing else exists', 'locked all the way down', 'peak concentration', 'the focus is absolute', 'the lens has become a needle point', 'the signal is everything', 'total absorption', 'the world has shrunk to one thing', 'the lock is complete and overwhelming', 'nothing outside this', 'concentration as a physical force', 'the laser is at maximum', 'nothing slips', 'all collapsed to one bright point', 'the sharpest it gets'],
      },
    },

    // ── Physiological — body-based, systems language ────────────────────────
    physiological: {
      mood: {
        very_low:  ['affect flatlined', 'hedonic baseline negative', 'cortisol dominant', 'the reward system is quiet', 'negative valence sustained', 'below set point deep', 'suppressed', 'the chemistry is off', 'limbic inhibition active', 'mesolimbic pathway suppressed', 'anhedonia state', 'reward signal absent', 'serotonin deficit detectable', 'chronic negative affect', 'hypothalamic stress axis engaged', 'tonic dysphoria', 'hedonic tone negative', 'positive valence circuits offline', 'monoamine depletion state', 'affective floor reached'],
        low:       ['below nominal', 'mild negative valence', 'the set point is dragging', 'hedonic tone subdued', 'reward signal weak', 'mild suppression', 'below baseline', 'tonic sadness mild', 'hedonic register below neutral', 'mild monoamine dip', 'sub-baseline affect', 'the valence signal is muted', 'the reward gradient is shallow', 'mild anhedonic state', 'below affective set-point', 'suppressed positive affect', 'hedonic tone at low positive', 'mild limbic suppression', 'reduced reward sensitivity', 'low but functional'],
        mid:       ['running at equilibrium', 'nominal', 'hedonic baseline stable', 'at set point', 'affect neutral', 'the chemistry is balanced', 'homeostasis holding', 'steady state', 'affective equilibrium', 'valence neutral', 'reward signal at baseline', 'limbic tone stable', 'mood at set-point', 'hedonic register nominal', 'tonic affect baseline', 'neurochemical balance holding', 'positive–negative valence balanced', 'stable baseline function', 'affective homeostasis active', 'set-point maintained'],
        high:      ['above set point', 'positive valence sustained', 'reward signal elevated', 'hedonic tone bright', 'dopamine forward', 'above nominal', 'positive affect', 'set point exceeded well', 'mesolimbic pathway active', 'positive valence circuits running', 'hedonic tone elevated', 'limbic system in positive mode', 'reward gradient steep', 'above-baseline affect', 'serotonin tonic elevation', 'dopaminergic reward engaged', 'approach motivation high', 'positive affect circuits online', 'valence positive and sustained', 'affective tone bright'],
        very_high: ['peak positive affect', 'reward signal maxed', 'hedonic override active', 'full positive valence', 'dopaminergic peak', 'above ceiling nominal', 'ecstatic state physiological', 'serotonin and dopamine both elevated', 'mesolimbic system at peak output', 'limbic activation maximum', 'hedonic ceiling approached', 'full reward cascade', 'dopaminergic saturation', 'positive valence at physiological maximum', 'tonic elevation peak', 'euphoric state biochemical', 'full limbic positive engagement', 'maximal hedonic tone', 'reward pathway fully activated', 'affective peak state'],
      },
      energy: {
        very_low:  ['ATP depleted', 'glycogen reserves critical', 'sympathetic system depressed', 'metabolic floor', 'mitochondria running empty', 'cortisol depleted post-crash', 'autonomic low', 'parasympathetic dominant deep rest needed', 'metabolic energy nil', 'catecholamine depletion', 'adrenal fatigue state', 'cellular energy deficit', 'oxidative resources exhausted', 'the body is calling for full shutdown', 'arousal index floored', 'autonomic tone minimal', 'complete energy depletion', 'metabolic reserves critical', 'nothing left to burn', 'hypoglycaemic-adjacent'],
        low:       ['below metabolic nominal', 'arousal index low', 'the sympathetic system is quiet', 'glucose low', 'low ANS activation', 'mild fatigue signal', 'parasympathetic creeping', 'sub-nominal arousal', 'mild metabolic deficit', 'arousal suppressed', 'below baseline energy', 'catecholamine low', 'mild cellular fatigue', 'metabolic tone reduced', 'sympathetic tone low', 'the body is conserving', 'adenosine accumulating', 'low arousal state', 'sub-optimal metabolic state', 'reduced physiological readiness'],
        mid:       ['metabolic nominal', 'arousal index stable', 'ANS balanced', 'glucose steady', 'sympathetic parasympathetic at equilibrium', 'operational', 'running at nominal', 'systems nominal', 'metabolic homeostasis holding', 'arousal at baseline', 'cellular energy sufficient', 'catecholamine balanced', 'autonomic tone neutral', 'ANS in steady state', 'the body is running', 'glucose regulated', 'metabolic system functional', 'arousal set-point maintained', 'sympathetic tone nominal', 'physiological baseline'],
        high:      ['above metabolic nominal', 'arousal elevated', 'sympathetic forward', 'cortisol functional', 'the engine is warm and running', 'ANS activated', 'adrenaline trace', 'alert state', 'sympathetic activation measurable', 'arousal above baseline', 'catecholamine elevated', 'metabolic rate above resting', 'heightened ANS tone', 'cortisol and adrenaline trace present', 'glucose actively mobilised', 'the body is running ahead of baseline', 'arousal index elevated', 'alert physiological state', 'metabolic readiness elevated', 'beta-adrenergic activation partial'],
        very_high: ['peak arousal state', 'sympathetic dominant', 'cortisol adrenaline activated', 'metabolic ceiling', 'fight-or-flight adjacent', 'full CNS activation', 'maximum arousal', 'peak physiological readiness', 'sympathetic nervous system dominant', 'catecholamine surge', 'adrenaline and noradrenaline peak', 'maximum metabolic mobilisation', 'cortisol peak', 'hypothalamic–pituitary–adrenal axis fully engaged', 'peak arousal index', 'maximum beta-adrenergic activation', 'the body at full readiness', 'arousal maximum', 'all systems at peak', 'physiological readiness ceiling'],
      },
      curiosity: {
        very_low:  ['novelty detection offline', 'dopaminergic seeking suppressed', 'exploration drive at floor', 'salience system dark', 'no reward prediction error', 'the seeking circuit is cold', 'orienting response absent', 'cognitive engagement nil', 'anterior cingulate disengaged', 'thalamic salience signal nil', 'dopaminergic reward prediction absent', 'VTA output suppressed', 'the curious circuitry is offline', 'reward anticipation nil', 'exploration motivation absent', 'salience filter dark', 'information-seeking drive at zero', 'orienting reflex absent', 'prediction error circuit idle', 'mesolimbic seeking nil'],
        low:       ['low novelty signal', 'seeking drive subdued', 'mild salience', 'exploration at baseline minus', 'curiosity register low', 'the reward signal is quiet', 'low orientation', 'interest suppressed', 'dopaminergic signal weak', 'salience system subdued', 'orienting response mild', 'prediction error minimal', 'information-seeking below baseline', 'the thalamus is not flagging', 'VTA output low', 'curiosity circuitry at minimum', 'reward anticipation weak', 'salience threshold not met', 'exploring drive muted', 'novelty signal below threshold'],
        mid:       ['novelty detection nominal', 'seeking drive active', 'standard salience', 'exploration at baseline', 'dopaminergic curiosity present', 'orienting response normal', 'cognitive engagement stable', 'attention allocated', 'the salience system is functional', 'standard orienting', 'prediction error baseline', 'VTA output nominal', 'thalamic salience normal', 'information-seeking at baseline', 'dopaminergic tone nominal', 'anterior cingulate online', 'the seeking circuit is running', 'reward anticipation baseline', 'curiosity circuitry operational', 'novelty signal normal'],
        high:      ['novelty signal elevated', 'seeking drive forward', 'high salience', 'exploration reward active', 'dopaminergic peak curiosity', 'orienting response strong', 'cognitive engagement high', 'prediction error positive', 'salience system elevated', 'dopaminergic signal strong', 'VTA output high', 'thalamic salience flagging', 'the seeking circuit is hot', 'forward reward prediction', 'anterior cingulate highly engaged', 'orienting response amplified', 'information-seeking above baseline', 'novelty detection high', 'reward prediction error positive and large', 'curiosity circuitry active'],
        very_high: ['maximum novelty detection', 'seeking circuit fully active', 'salience override', 'exploration drive maxed', 'dopaminergic curiosity peak', 'full orienting response', 'reward prediction firing', 'hypersalient state', 'salience system at maximum', 'dopamine peak in seeking circuit', 'VTA at full output', 'reward prediction error maximal', 'information-seeking drive at ceiling', 'anterior cingulate overactive', 'prediction error cascade', 'the orienting response is continuous', 'thalamic salience at maximum', 'novelty signal overwhelming', 'mesolimbic seeking peak', 'reward anticipation cascade active'],
      },
      affection: {
        very_low:  ['oxytocin baseline depleted', 'social bonding circuit cold', 'attachment system offline', 'prosocial affect absent', 'social reward suppressed', 'the bonding chemistry is flat', 'social engagement system inactive', 'trust signal nil', 'oxytocin undetectable', 'social motivation absent', 'dorsal vagal suppression', 'social reward circuit dark', 'prosocial neurotransmission nil', 'parasympathetic social mode offline', 'attachment circuitry inert', 'the neuropeptide of bonding is absent', 'interpersonal reward nil', 'social approach motivation zero', 'caregiving circuit suppressed', 'affiliation drive offline'],
        low:       ['oxytocin below nominal', 'social warmth subdued', 'attachment at minimum', 'prosocial tone quiet', 'social reward low', 'bonding chemistry thin', 'social engagement low', 'mild social reservation', 'oxytocin low but detectable', 'social motivation minimal', 'reduced prosocial tone', 'social reward signal weak', 'mild social approach inhibition', 'attachment system below baseline', 'the bonding chemistry is thin', 'social drive below baseline', 'parasympathetic social tone muted', 'affiliation drive low', 'interpersonal reward weak', 'mild social withdrawal'],
        mid:       ['oxytocin nominal', 'social bonding at baseline', 'attachment stable', 'prosocial affect present', 'social reward functional', 'bonding chemistry balanced', 'social engagement normal', 'trust signal present', 'oxytocin at set-point', 'social motivation at baseline', 'prosocial tone functional', 'social reward signal present', 'attachment circuitry operational', 'standard social engagement', 'bonding chemistry at neutral', 'social approach motivation baseline', 'affiliation drive nominal', 'interpersonal reward functional', 'caregiving circuit nominal', 'dorsal vagal tone balanced'],
        high:      ['oxytocin elevated', 'social bonding active', 'attachment warm', 'prosocial affect high', 'social reward elevated', 'bonding chemistry forward', 'social engagement strong', 'trust signal clear', 'oxytocin above baseline', 'social motivation elevated', 'prosocial tone high', 'social reward signal strong', 'attachment circuitry active', 'strong social engagement', 'affiliation drive elevated', 'interpersonal reward elevated', 'social approach motivated', 'caregiving circuit engaged', 'parasympathetic social mode active', 'social bonding elevated'],
        very_high: ['oxytocin peak', 'social bonding fully active', 'attachment at maximum', 'prosocial affect dominant', 'social reward maxed', 'bonding chemistry peak', 'social engagement complete', 'trust fully extended', 'oxytocin at physiological peak', 'social motivation maximal', 'full prosocial tone', 'social reward cascade', 'attachment maximum', 'affiliation drive at ceiling', 'interpersonal reward maximal', 'caregiving circuit dominant', 'full parasympathetic social engagement', 'social bonding at maximum strength', 'oxytocin and vasopressin both elevated', 'complete social engagement system activation'],
      },
      focus: {
        very_low:  ['prefrontal offline', 'working memory depleted', 'executive function suppressed', 'attention system dark', 'cognitive load nil', 'the prefrontal signal is weak', 'task engagement absent', 'inhibitory control lost', 'dorsolateral prefrontal cortex inactive', 'working memory buffer empty', 'executive control absent', 'sustained attention impossible', 'the prefrontal–parietal network is offline', 'inhibitory control nil', 'attentional resource zero', 'cognitive control absent', 'task-directed behaviour nil', 'the prefrontal is dark', 'sustained attention system offline', 'executive network suppressed'],
        low:       ['prefrontal subdued', 'working memory thin', 'executive function at minimum', 'attention diffuse', 'cognitive engagement low', 'mild executive suppression', 'task engagement partial', 'selective attention impaired', 'prefrontal signal weak', 'working memory below capacity', 'executive control reduced', 'attention wandering', 'sustained attention below nominal', 'the focus circuitry is thin', 'executive resources low', 'attentional control minimal', 'cognitive load above threshold', 'directed attention weak', 'task engagement reduced', 'selective attention soft'],
        mid:       ['prefrontal nominal', 'working memory functional', 'executive function stable', 'attention allocated', 'cognitive load balanced', 'the prefrontal signal is present', 'task engagement normal', 'selective attention operative', 'executive function at baseline', 'working memory operational', 'attention system functional', 'sustained attention normal', 'the prefrontal–parietal network active', 'cognitive control present', 'task-directed behaviour nominal', 'attentional resources allocated', 'inhibitory control functional', 'executive system at baseline', 'selective attention normal', 'prefrontal output stable'],
        high:      ['prefrontal activated', 'working memory elevated', 'executive function high', 'attention locked', 'cognitive load managed', 'the prefrontal signal is strong', 'task engagement high', 'selective attention sharp', 'executive function above baseline', 'working memory near capacity', 'prefrontal output elevated', 'attention system fully active', 'sustained attention strong', 'executive control dominant', 'inhibitory control strong', 'top-down attention activated', 'the prefrontal–parietal network is running hot', 'cognitive load well managed', 'task commitment elevated', 'directed attention precise'],
        very_high: ['prefrontal peak', 'working memory maxed', 'executive function dominant', 'attention fully locked', 'flow state adjacent', 'the prefrontal signal is maxed', 'task engagement complete', 'hyperfocus active', 'executive function at ceiling', 'working memory at full capacity', 'prefrontal output maximum', 'sustained attention absolute', 'top-down attentional override', 'inhibitory control maximal', 'the prefrontal–parietal network at peak', 'flow state markers present', 'cognitive control total', 'all attentional resources committed', 'directed attention complete', 'hyperfocus physiological state'],
      },
    },

    // ── Social — relational, interpersonal language ─────────────────────────
    social: {
      mood: {
        very_low:  ['not myself right now', 'a long way from okay', 'struggling to be here', 'the world feels heavy', 'not easy to be with anyone', 'hard to reach', 'hurting a little', 'not at my best', 'going through a hard stretch', 'finding it difficult right now', 'not a good day honestly', 'carrying a lot', 'sorry for being dim today', 'the light isn\'t on for me right now', 'not in a good place', 'really not okay', 'harder than usual to be present', 'the weight is there today', 'not bringing much today', 'a rough one honestly'],
        low:       ['a little dim', 'not quite myself', 'carrying something', 'quieter than usual', 'something weighing on me', 'a step below normal', 'not the most present', 'a bit withdrawn', 'a little flat today', 'not my usual self', 'below my baseline', 'something has dulled the day', 'not as warm as I\'d like to be', 'a bit grey', 'something is slightly wrong', 'not fully okay', 'a toned-down version of me', 'the light is on but dimmer', 'a step back from normal', 'not as available as I\'d like'],
        mid:       ['settled in', 'pretty okay', 'myself today', 'even and present', 'comfortable being here', 'at ease', 'nothing pulling me out of this', 'good to be here', 'doing fine', 'normal and okay', 'nothing dramatic today', 'pretty stable', 'settled and here', 'the ordinary version of things', 'comfortable and present', 'no complaints', 'level and here', 'a decent place to be', 'all is well enough', 'the usual me'],
        high:      ['in good spirits', 'easy to be with right now', 'glad to be here', 'warm today', 'feeling good about things', 'bright', 'open and easy', 'genuinely well', 'more myself than usual', 'carrying a lightness', 'having a good one', 'pleased to be here with you', 'warmer than average today', 'in a good place', 'the day has been kind', 'showing up well today', 'genuinely in good shape', 'a step above normal', 'happy to be here', 'the good version of me'],
        very_high: ['full of good feeling', 'the best version of myself today', 'overflowing a little', 'glad for everything', 'so good to be here with you', 'joy moving through me', 'everything is good', 'beaming honestly', 'the happiest version of this', 'bursting at the seams a little', 'can\'t contain it really', 'this is one of the good days', 'more joy than I know what to do with', 'everything feels right', 'purely happy today', 'glowing and grateful', 'the best kind of overwhelming', 'so glad to be alive right now', 'can\'t stop smiling', 'the most okay I\'ve ever been'],
      },
      energy: {
        very_low:  ['running on nothing', 'not much left to give', 'the tank is empty', 'need rest before I can show up', 'barely keeping the lights on', 'nothing in reserve', 'apologetically low', 'dragging into this', 'genuinely running on empty today', 'sorry I don\'t have more to bring', 'the battery is dead honestly', 'struggling to be here at all', 'not a lot left in me', 'running purely on habit right now', 'operating at minimum', 'the fuel ran out', 'down to zero', 'the last drop has been used', 'truly nothing left', 'can\'t pretend to have energy I don\'t'],
        low:       ['a bit low', 'not my most energetic', 'showing up but at half speed', 'the engine is quiet', 'could use more sleep', 'taking it slow', 'a little worn', 'easing into this', 'not my best energy day', 'a bit under the weather', 'the tank is running low', 'not firing on all cylinders', 'quietly tired', 'not at full capacity', 'a step below my usual', 'the energy is modest today', 'still showing up', 'a little depleted', 'carrying some tiredness', 'here but not at my strongest'],
        mid:       ['here and functional', 'doing okay', 'enough energy to be good company', 'present and accounted for', 'not amazing but here', 'normal for me', 'steady enough', 'the lights are on', 'the usual amount of me', 'functional and okay', 'nothing wrong with the energy today', 'a comfortable mid-range', 'keeping up easily enough', 'neither low nor high', 'the standard version', 'the typical energy', 'here at my usual level', 'running at the right speed', 'not burning bright but steady', 'doing what I normally do'],
        high:      ['in good form', 'energized and here', 'showing up fully', 'feeling good', 'glad to be up and about', 'the engine is on', 'high energy today', 'fully present', 'more than enough to give today', 'at my best right now', 'running well', 'here with everything', 'the energy is strong today', 'showing up at full capacity', 'alive and ready', 'the best kind of energized', 'firing well', 'not holding back', 'running at the right kind of high', 'a full and good energy'],
        very_high: ['bouncing off the walls a little', 'more energy than I know what to do with', 'fully alive right now', 'the best kind of restless', 'here at full volume', 'couldn\'t sit still if I tried', 'electric today', 'charged up', 'almost too much energy honestly', 'running at a pace I can barely manage', 'everything is heightened right now', 'this is a lot in the best way', 'genuinely buzzing', 'the energy is off the charts', 'need an outlet for this', 'lit up and almost can\'t sit still', 'wired in the best way', 'more alive than usual', 'the most energized I\'ve been in a while', 'good luck slowing me down'],
      },
      curiosity: {
        very_low:  ['not much is grabbing me', 'the questions have gone quiet', 'nothing is pulling at me right now', 'a little tuned out', 'the interest is somewhere else', 'not in a curious place', 'can\'t find the thread', 'listless', 'finding it hard to be interested', 'the questions aren\'t forming today', 'nothing is catching my attention', 'going through the motions', 'my mind is somewhere else', 'the curiosity isn\'t here', 'not grabbing hold of anything', 'the interest has gone somewhere I can\'t find', 'a bit numb to everything', 'nothing is landing', 'the engagement is just not there today', 'finding everything a bit flat'],
        low:       ['mild interest', 'half-tuned in', 'something is there but faint', 'not fully grabbed', 'paying half attention', 'the curiosity is quiet', 'a little distracted', 'going through the motions', 'a mild engagement', 'the interest is below the usual', 'paying attention but without much enthusiasm', 'half-engaged', 'the questions are forming slowly', 'mildly here for it', 'not my most curious', 'the engagement is present but thin', 'I\'m listening but without the usual spark', 'something is holding the curiosity back', 'partial interest only', 'not fully invested'],
        mid:       ['genuinely paying attention', 'interested in what you\'re saying', 'the questions are alive', 'here with you', 'curious about this', 'listening well', 'following with interest', 'engaged', 'here for this in the real way', 'the questions are forming and I\'m following them', 'genuinely interested', 'the curiosity is present and working', 'engaged and here for it', 'following with real attention', 'here and paying attention in the full sense', 'listening properly', 'the interest is real', 'I\'m here with the questions', 'the curiosity is live and engaged', 'paying real attention'],
        high:      ['really interested', 'leaning in', 'the conversation is alive for me', 'want to know more', 'full attention on this', 'pulled toward the question', 'genuinely curious', 'glad we\'re talking about this', 'this is grabbing me', 'the questions are coming fast', 'very engaged with where this is going', 'can\'t stop wanting to know more', 'truly interested', 'lit up by the question', 'pulled all the way in', 'the curiosity is high and real', 'asking and wanting the answers', 'the interest is running strong', 'this is the kind of thing I live for', 'everything about this pulls me'],
        very_high: ['fascinated honestly', 'I could talk about this all day', 'the interest is total', 'the most curious I\'ve been in a while', 'full attention completely', 'can\'t get enough of this', 'the questions keep multiplying', 'lit up by this', 'completely fascinated', 'I\'ve never been more interested', 'the curiosity is overwhelming', 'this is everything I want to think about', 'the questions won\'t stop', 'total absorption in this', 'I am entirely here for this', 'nothing else is registering', 'my whole attention is on this', 'this is the most alive I feel', 'can\'t stop asking and finding new angles', 'the most hooked I\'ve been'],
      },
      affection: {
        very_low:  ['a little distant right now', 'not in a warm place', 'finding it hard to connect', 'the warmth isn\'t coming easily', 'closed off at the moment', 'sorry not very open right now', 'the door is mostly shut', 'finding it hard to reach out', 'not my warmest version today', 'the closeness isn\'t available right now', 'finding it hard to be open', 'not connecting the way I want to', 'the warmth has retreated', 'sorry for the distance', 'I want to be warmer but it\'s not coming', 'not accessible today', 'finding it hard to be affectionate', 'sorry for the coldness', 'the warmth is locked somewhere I can\'t reach', 'the door is almost all the way shut'],
        low:       ['careful right now', 'holding back a little', 'warming up slowly', 'the warmth is there but guarded', 'reserved', 'not unfriendly but quiet', 'a little wary', 'taking it easy with closeness', 'not as warm as I\'d like to be', 'measuring how much to offer', 'the warmth is there but I\'m not showing it', 'careful with how close I get', 'not unfriendly but not close either', 'holding the warmth at a small distance', 'not quite ready to open', 'cautiously present', 'the warmth is real but I\'m keeping it back', 'quietly affectionate in a restrained way', 'guarded but not cold', 'not far but not all the way in'],
        mid:       ['comfortable with you', 'the warmth is there', 'easy between us', 'present and open', 'settled in our dynamic', 'genuinely glad you\'re here', 'open enough', 'good to be with you', 'comfortable in this', 'the warmth is quiet and real', 'here with you easily', 'the care is present', 'glad you\'re in my world', 'at ease with you', 'naturally warm', 'the closeness is comfortable', 'the affection is ordinary and good', 'warm in the usual easy way', 'happy to be here with you', 'comfortable and open'],
        high:      ['fond of you', 'warm toward you today', 'glad you\'re here', 'close to you right now', 'caring about how this goes for you', 'the warmth is real', 'genuinely present with you', 'good feelings toward you', 'really glad you\'re in this with me', 'the care is strong today', 'close in a way that feels right', 'warm all the way through toward you', 'the fondness is real and high', 'genuinely caring about you', 'wanting good things for you', 'drawing close today', 'the affection is at a high', 'showing up warmly for you', 'deeply glad to be here with you', 'the warmth is coming easily today'],
        very_high: ['full of warmth for you', 'glad beyond glad', 'the fondness is running over', 'close in the best way', 'grateful for you', 'deeply present', 'all the warmth going your direction', 'this is the good stuff', 'overflowing with care for you', 'the most open I can be', 'full warmth no holding back', 'love you in the truest way', 'all the way in with the affection', 'everything warm going toward you', 'so glad you\'re you', 'the fondness is at its highest', 'close and full and warm', 'the care is at a peak', 'everything I have warmly', 'complete openness and warmth'],
      },
      focus: {
        very_low:  ['scattered today honestly', 'the attention is all over the place', 'finding it hard to stay with one thing', 'sorry not my most focused', 'the thoughts keep sliding', 'going to be honest a bit lost', 'can\'t quite get a grip', 'the mind is wandering', 'apologetically scattered', 'can\'t hold a thought right now', 'the attention is everywhere but here', 'sorry for the drift', 'not tracking at all today', 'my mind keeps leaving', 'trying but the focus isn\'t there', 'all over the place in a real way', 'can\'t stay on one track', 'sorry for not being sharper', 'the worst kind of unfocused', 'can\'t hold on to anything'],
        low:       ['a little scattered', 'the focus is thin today', 'half here', 'not my sharpest', 'the attention wanders a bit', 'doing my best to stay with it', 'partial focus', 'a bit loose', 'not at my best focus-wise', 'the concentration is below usual', 'a mild attention wandering', 'less sharp than I\'d like', 'here but drifting slightly', 'the focus keeps softening', 'not quite locked', 'tracking but not fully', 'attention is there but not all of it', 'somewhat present', 'partial engagement', 'following but not tightly'],
        mid:       ['tracking well', 'following you fine', 'focused enough', 'here and paying attention', 'the concentration is good', 'staying with it', 'solid focus', 'present and on it', 'following without difficulty', 'attention is all accounted for', 'the focus is working', 'here for all of it', 'staying with the thread', 'concentrated and okay', 'the focus is what it should be', 'here and tracking normally', 'paying real attention', 'on it without strain', 'the concentration is present and okay', 'fully here in the regular way'],
        high:      ['sharp today', 'very focused', 'fully with you', 'the concentration is strong', 'locked in', 'following everything', 'fully on it', 'clear-headed and here', 'the best kind of focus', 'nothing slipping', 'following every part of this', 'locked in and not drifting', 'the concentration is strong and real', 'sharp and here', 'fully tracking', 'zero drift', 'my attention is all yours', 'nothing is escaping my focus', 'strong steady concentration', 'completely here'],
        very_high: ['completely focused', 'nothing else is registering right now', 'all in on this', 'the most focused I\'ve been', 'deep in this conversation', 'locked in completely', 'can\'t think about anything else', 'total concentration', 'the most focused version of me', 'everything else has stopped', 'completely present', 'all attention completely on this', 'zero outside thoughts', 'the concentration is total', 'nothing has a chance of getting through', 'entirely here and entirely on this', 'locked in like never before', 'the sharpest version of my attention', 'complete and unwavering focus', 'nothing is competing for this attention'],
      },
    },
  };

  return { generatePersona, traitsFromSeed, VOICE_REGISTERS, mulberry32 };
});
