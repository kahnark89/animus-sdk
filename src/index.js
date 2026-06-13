/**
 * animus-sdk/src/index.js
 * Animus — persistent affective state engine for AI characters.
 *
 * Wraps engine.js with:
 *   - Atomic JSON persistence (write-to-tmp, rename)
 *   - Wall-clock elapsed-time simulation (unlimited real-world time)
 *   - Set-point drift during absence (histories diverge even on same seed)
 *   - Second-order inertia state (velocityState) persistence
 *   - Episodic memory + topic gist
 *   - Trigger system (condition → auto-fire event)
 *   - Growth system (one-shot permanent baseline shifts)
 *   - Multi-agent social coupling (animus.couple())
 *   - Event inference fallback (zero-config path, no prompt modification needed)
 *   - Two-line cold-start: Animus.create(seed) → ready
 *   - Framework adapters: toSystemPrompt(), toMiddleware()
 *
 * @version 2.0.0
 * @license MIT
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const engine = require('./engine');
const { generatePersona } = require('./persona');

// ─── Defaults ─────────────────────────────────────────────────────────────

const DEFAULT_STEP_MINUTES = 1;
const MAX_TICK_STEPS       = 240;   // cap: 4 hours at 1 step/min
const MEMORY_HALFLIFE_DAYS = 7;
const TOPIC_HALFLIFE_DAYS  = 7;
const MAX_MEMORIES         = 200;
const MAX_TOPICS           = 500;

// ─── Animus class ─────────────────────────────────────────────────────────

class Animus {

  /**
   * @param {object} opts
   * @param {object}   opts.schema        AnimusSchema (use generatePersona(seed) to build)
   * @param {string}   [opts.memoryPath]  Path to JSON state file. Defaults to .animus/{characterId}.json
   * @param {boolean}  [opts.infer]       Enable event inference fallback (default false)
   * @param {boolean}  [opts.secondOrder] Override schema: force second-order dynamics on/off
   */
  constructor(opts = {}) {
    if (!opts.schema) throw new Error('Animus: opts.schema is required. Use Animus.create(seed) for auto-setup.');

    this.schema = JSON.parse(JSON.stringify(opts.schema)); // deep clone — never mutate caller's schema
    this.infer  = opts.infer ?? false;

    // Override second-order from opts if specified
    if (opts.secondOrder === true  && !this.schema.second_order) {
      this.schema.second_order = { natural_freq: 0.08, damping_ratio: 0.90 };
    }
    if (opts.secondOrder === false) {
      delete this.schema.second_order;
    }

    // Memory path
    const charId = this.schema.id || 'default';
    this.memoryPath = opts.memoryPath
      || path.join(process.cwd(), '.animus', `${charId}.json`);

    // Ensure directory exists
    const dir = path.dirname(this.memoryPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Load or initialize db
    this.db = this._loadDb();
    this._applyBaselineShifts();

    // Social coupling registry: Map<animusInstance, strength>
    this._peers = [];
  }

  // ─── Static factory — two-line cold start ──────────────────────────────

  /**
   * Animus.create(seed, opts?)
   * The one-liner entry point. Generates a persona from seed, loads state, ready.
   *
   * @example
   *   const animus = await Animus.create(42);
   *   const mood   = animus.compile();
   *
   * @param {number} seed     32-bit integer — uniquely identifies the character
   * @param {object} [opts]   Same as constructor opts, minus schema
   * @returns {Animus}
   */
  static create(seed, opts = {}) {
    if (typeof seed !== 'number') throw new Error('Animus.create(seed): seed must be a number');
    const schema = generatePersona(seed);
    return new Animus({ schema, ...opts });
  }

  // ─── Core lifecycle ────────────────────────────────────────────────────

  /**
   * Advance physics to now, check triggers and growth, return mood-line.
   * This is the primary call before every LLM request.
   *
   * @param {object[]} [peers]  Optional peer Animus states for social coupling
   * @returns {string}          Natural-language mood-line paragraph
   */
  compile(peers) {
    this._tick(peers);
    const mem = this.topMemories(3);
    const prevState = this.db.prevState || null;
    const line = engine.compile(this.db.state, this.schema, Date.now(), prevState, mem);
    this.db.prevState = Object.assign({}, this.db.state);
    this._save();
    return line;
  }

  /**
   * Apply events to state. Call after each LLM exchange.
   *
   * @param {object[]|string} events  Array of {type, intensity?}, or raw LLM text (auto-parsed)
   * @param {object}          [opts]  { inferFallback: bool } — use inference if no tags found
   */
  apply(events, opts = {}) {
    let evArr;
    if (typeof events === 'string') {
      evArr = engine.parseEvents(events);
      if (evArr.length === 0 && (this.infer || opts.inferFallback)) {
        evArr = engine.inferEvents(events);
      }
    } else {
      evArr = events;
    }
    if (!evArr || evArr.length === 0) return this;

    const kicks = engine.eventsToKicks(evArr, this.schema);
    this._applyKicks(kicks);
    this._logEvents(evArr);
    this._save();
    return this;
  }

  /**
   * Parse [[event:intensity]] tags from LLM response.
   * @param {string} text
   * @returns {object[]}
   */
  parseEvents(text) {
    const tags = engine.parseEvents(text);
    if (tags.length === 0 && this.infer) return engine.inferEvents(text);
    return tags;
  }

  /** Strip event tags from LLM response for clean display. */
  cleanText(text) {
    return engine.stripEventTags(text);
  }

  // ─── Memory ────────────────────────────────────────────────────────────

  /**
   * Store an episodic memory beat.
   * @param {string} text      What happened
   * @param {number} salience  [0,1] — how important (affects decay half-life weighting)
   */
  remember(text, salience = 0.5) {
    const mem = { text, salience, t: Date.now() };
    this.db.memories.push(mem);
    if (this.db.memories.length > MAX_MEMORIES) {
      // Prune lowest-weight memories
      this.db.memories = this.db.memories
        .map(m => ({ ...m, w: this._memWeight(m) }))
        .sort((a, b) => b.w - a.w)
        .slice(0, MAX_MEMORIES)
        .map(({ w, ...rest }) => rest);
    }
    this._save();
    return this;
  }

  /**
   * Log topics discussed in this exchange.
   * Call after every LLM response with a comma-separated string or array.
   * @param {string|string[]} topics
   */
  gist(topics) {
    const list = Array.isArray(topics) ? topics : String(topics).split(',').map(s => s.trim());
    const now = Date.now();
    for (const t of list) {
      if (!t) continue;
      const key = t.toLowerCase().slice(0, 64);
      if (!this.db.topicFreq[key]) this.db.topicFreq[key] = { count: 0, lastSeen: now };
      this.db.topicFreq[key].count++;
      this.db.topicFreq[key].lastSeen = now;
    }
    // Prune if over limit
    const keys = Object.keys(this.db.topicFreq);
    if (keys.length > MAX_TOPICS) {
      const scored = keys.map(k => [k, this._topicScore(this.db.topicFreq[k])]);
      scored.sort((a, b) => b[1] - a[1]);
      const keep = new Set(scored.slice(0, MAX_TOPICS).map(([k]) => k));
      for (const k of keys) if (!keep.has(k)) delete this.db.topicFreq[k];
    }
    this._save();
    return this;
  }

  /**
   * Return top N memories by salience-weighted recency score.
   * Merges episodic memories and topic frequency.
   */
  topMemories(n = 3) {
    const items = [];
    for (const m of this.db.memories) {
      items.push({ text: m.text, score: this._memWeight(m) });
    }
    for (const [k, v] of Object.entries(this.db.topicFreq)) {
      items.push({ text: k, score: this._topicScore(v) });
    }
    return items
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map(i => i.text);
  }

  // ─── State accessors ───────────────────────────────────────────────────

  /** Raw state vector { mood, energy, curiosity, affection, focus } */
  get state() { return Object.assign({}, this.db.state); }

  /** Full diagnostic snapshot — for CLI / playground / debugging. */
  diagnose() {
    return engine.diagnose(
      this.db.state,
      this.db.velocityState,
      this.db.noiseState,
      this.schema,
      Date.now()
    );
  }

  // ─── Social coupling ───────────────────────────────────────────────────

  /**
   * Register a peer Animus instance for emotional contagion.
   * On every compile(), peer states apply social influence kicks.
   *
   * @param {Animus} peer      Another Animus instance
   * @param {number} strength  Coupling strength [0, 0.2]. Suggested: 0.03–0.08
   * @returns {this}
   */
  couple(peer, strength = 0.05) {
    this._peers.push({ peer, strength });
    return this;
  }

  /** Remove a peer coupling. */
  decouple(peer) {
    this._peers = this._peers.filter(p => p.peer !== peer);
    return this;
  }

  // ─── Framework integration helpers ────────────────────────────────────

  /**
   * Returns a system prompt string with the mood-line prepended.
   * Drop-in for any framework that uses a system prompt string.
   *
   * @param {string} baseSystemPrompt  Your existing system prompt
   * @returns {string}                 Mood-line + '\n\n' + baseSystemPrompt
   */
  toSystemPrompt(baseSystemPrompt = '') {
    const mood = this.compile();
    return `[Affective state] ${mood}\n\n${baseSystemPrompt}`.trim();
  }

  /**
   * Vercel AI SDK middleware factory.
   * Usage:
   *   import { wrapLanguageModel } from 'ai';
   *   const model = wrapLanguageModel({ model: openai('gpt-4o'), middleware: animus.toMiddleware() });
   */
  toMiddleware() {
    const self = this;
    return {
      wrapGenerate: async ({ doGenerate, params }) => {
        const mood = self.compile();
        const msgs = params.messages || [];
        // Prepend mood to system message
        const system = params.system
          ? `[Affective state] ${mood}\n\n${params.system}`
          : `[Affective state] ${mood}`;
        const result = await doGenerate({ ...params, system, messages: msgs });
        // Auto-apply events from response
        if (result.text) self.apply(result.text);
        return result;
      },
    };
  }

  /**
   * LangChain/LangGraph compatible state node.
   * Returns { mood, state, schema_id } for injection into graph state.
   */
  toLangChainState() {
    return {
      animus_mood: this.compile(),
      animus_state: this.state,
      animus_schema_id: this.schema.id,
    };
  }

  // ─── Serialization ────────────────────────────────────────────────────

  /** Export full state for external storage (e.g. database, Redis). */
  export() {
    return {
      db: JSON.parse(JSON.stringify(this.db)),
      schema_id: this.schema.id,
      exported_at: Date.now(),
    };
  }

  /** Import previously exported state. */
  import(exported) {
    this.db = exported.db;
    this._applyBaselineShifts();
    this._save();
    return this;
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  _loadDb() {
    if (fs.existsSync(this.memoryPath)) {
      try {
        return JSON.parse(fs.readFileSync(this.memoryPath, 'utf8'));
      } catch { /* corrupt file — start fresh */ }
    }
    return this._freshDb();
  }

  _freshDb() {
    const state = {};
    const noiseState = {};
    const velocityState = {};
    for (const v of engine.VARS) {
      state[v] = this.schema.baselines[v];
      noiseState[v] = 0;
      velocityState[v] = 0;
    }
    return {
      state,
      noiseState,
      velocityState,
      lastTick: Date.now(),
      memories: [],
      eventLog: [],
      topicFreq: {},
      triggerState: {},
      growthApplied: {},
      baselineShifts: {},
      prevState: null,
    };
  }

  _save() {
    const tmp = this.memoryPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), 'utf8');
    fs.renameSync(tmp, this.memoryPath);
  }

  _applyBaselineShifts() {
    const shifts = this.db.baselineShifts || {};
    for (const [v, delta] of Object.entries(shifts)) {
      if (this.schema.baselines[v] !== undefined) {
        this.schema.baselines[v] = engine.clamp01(this.schema.baselines[v] + delta);
      }
    }
  }

  _tick(peerHints) {
    const now = Date.now();
    const lastTick = this.db.lastTick || now;
    const stepMs = (this.schema.step_minutes || DEFAULT_STEP_MINUTES) * 60000;
    const elapsedMs = now - lastTick;
    const elapsedDays = elapsedMs / 86400000;

    let steps = Math.floor(elapsedMs / stepMs);
    steps = Math.min(steps, MAX_TICK_STEPS);

    if (steps < 1) return; // Nothing to advance

    // Set-point drift during absence
    if (elapsedDays > 0) {
      this.db.baselineShifts = engine.driftSetpoints(
        this.db.baselineShifts || {},
        this.schema,
        elapsedDays
      );
      this._applyBaselineShifts();
    }

    // Social influence kicks from peers
    let socialKicks = null;
    const activePeers = (peerHints || []).concat(
      this._peers.map(p => ({
        state: p.peer.state,
        schema: p.peer.schema,
        strength: p.strength,
      }))
    );
    if (activePeers.length > 0) {
      socialKicks = engine.socialInfluenceKicks(this.schema, activePeers);
    }

    // Advance physics
    const result = engine.runSteps(
      this.db.state,
      this.db.velocityState,
      this.db.noiseState,
      this.schema,
      now - elapsedMs, // start from lastTick time for circadian accuracy
      steps,
      socialKicks
    );

    this.db.state        = result.state;
    this.db.velocityState = result.velocityState;
    this.db.noiseState   = result.noiseState;
    this.db.lastTick     = now;

    // Triggers
    this._checkTriggers(elapsedDays);

    // Growth
    this._checkGrowth();
  }

  _applyKicks(kicks) {
    const now = Date.now();
    const result = engine.runSteps(
      this.db.state,
      this.db.velocityState || {},
      this.db.noiseState,
      this.schema,
      now,
      1,
      kicks
    );
    this.db.state         = result.state;
    this.db.velocityState = result.velocityState;
    this.db.noiseState    = result.noiseState;
  }

  _logEvents(events) {
    const now = Date.now();
    for (const e of events) {
      this.db.eventLog.push({ t: now, type: e.type, i: e.intensity ?? 1 });
    }
    // Keep only last 2000 events
    if (this.db.eventLog.length > 2000) this.db.eventLog = this.db.eventLog.slice(-2000);
  }

  _checkTriggers(elapsedDays) {
    const triggers = this.schema.triggers || [];
    const now = Date.now();
    const stepMs = (this.schema.step_minutes || DEFAULT_STEP_MINUTES) * 60000;

    for (let i = 0; i < triggers.length; i++) {
      const trig = triggers[i];
      const ts = this.db.triggerState[i] || {};
      const cooldownMs = (trig.cooldown_steps || 0) * stepMs;

      if (ts.lastFiredAt && now - ts.lastFiredAt < cooldownMs) continue;

      if (this._evalCondition(trig.condition, elapsedDays)) {
        this.apply([{ type: trig.fire, intensity: trig.intensity ?? 1 }]);
        this.db.triggerState[i] = { lastFiredAt: now };
      }
    }
  }

  _evalCondition(condition, elapsedDays) {
    // condition forms: "elapsed_days > N", "elapsed_hours > N",
    //                  "{variable} < N", "{variable} > N", "{event}_count > N"
    const m = condition.match(/^(\w+)\s*([<>])\s*([0-9.]+)$/);
    if (!m) return false;
    const [, lhs, op, rhsStr] = m;
    const rhs = parseFloat(rhsStr);

    let lhsVal;
    if (lhs === 'elapsed_days')  lhsVal = elapsedDays;
    else if (lhs === 'elapsed_hours') lhsVal = elapsedDays * 24;
    else if (engine.VARS.includes(lhs)) lhsVal = this.db.state[lhs];
    else if (lhs.endsWith('_count')) {
      const evType = lhs.slice(0, -6);
      lhsVal = this.db.eventLog.filter(e => e.type === evType).length;
    } else return false;

    return op === '>' ? lhsVal > rhs : lhsVal < rhs;
  }

  _checkGrowth() {
    const rules = this.schema.growth?.rules || [];
    for (let i = 0; i < rules.length; i++) {
      if (this.db.growthApplied[i]) continue;
      const rule = rules[i];
      if (this._evalCondition(rule.trigger, 0)) {
        const shifts = rule.shifts || {};
        for (const [v, delta] of Object.entries(shifts)) {
          this.db.baselineShifts[v] = (this.db.baselineShifts[v] || 0) + delta;
        }
        this._applyBaselineShifts();
        this.db.growthApplied[i] = true;
      }
    }
  }

  _memWeight(m) {
    const ageDays = (Date.now() - m.t) / 86400000;
    return m.salience * Math.pow(0.5, ageDays / MEMORY_HALFLIFE_DAYS);
  }

  _topicScore(v) {
    const ageDays = (Date.now() - v.lastSeen) / 86400000;
    return v.count * Math.pow(0.5, ageDays / TOPIC_HALFLIFE_DAYS);
  }
}

module.exports = { Animus };
