/* animus-sdk public API. Engine math lives in engine.js (pure); this file owns
 * persistence (JSON db), wall-clock ticking, episodic memory, auto-triggers, and growth. */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./engine');
const { generatePersona } = require('./persona');

const MEM_HALFLIFE_DAYS = 7;    // salience halves weekly unless rehearsed
const MEM_CAP = 200;            // beats, not a transcript
const MAX_CATCHUP_STEPS = 240;  // returning after a week ≠ 10k steps
const TOPIC_CAP = 500;          // distinct topics tracked before pruning
const TOPIC_HALFLIFE_DAYS = 7;  // topic frequency weight halves weekly

// Minimal condition evaluator for schema.triggers and schema.growth.rules.
// Supported forms: "elapsed_days > N", "elapsed_hours > N",
//                  "{variable} < N", "{variable} > N", "{event}_count > N"
function evalCondition(cond, ctx) {
  if (!cond) return false;
  var m;
  if ((m = /^elapsed_days\s*>\s*([\d.]+)$/.exec(cond)))  return ctx.elapsed_days  > +m[1];
  if ((m = /^elapsed_hours\s*>\s*([\d.]+)$/.exec(cond))) return ctx.elapsed_hours > +m[1];
  if ((m = /^(\w+)_count\s*>\s*(\d+)$/.exec(cond)))      return (ctx.eventCounts[m[1]] || 0) > +m[2];
  if ((m = /^(\w+)\s*<\s*([\d.]+)$/.exec(cond))) return ctx.state[m[1]] != null && ctx.state[m[1]] < +m[2];
  if ((m = /^(\w+)\s*>\s*([\d.]+)$/.exec(cond))) return ctx.state[m[1]] != null && ctx.state[m[1]] > +m[2];
  return false;
}

class Animus {
  /** @param {{schema: string|object, memory?: string, now?: () => Date, rng?: () => number}} opts */
  constructor(opts) {
    if (!opts || !opts.schema) throw new Error('Animus: { schema } is required');
    try {
      this.schema = typeof opts.schema === 'string'
        ? JSON.parse(fs.readFileSync(opts.schema, 'utf8'))
        : opts.schema;
    } catch (e) {
      throw new Error('Animus: invalid schema — ' + e.message);
    }
    // If schema carries a persona seed, generate and merge physics from it.
    const pseed = this.schema.persona && typeof this.schema.persona.seed === 'number'
      ? this.schema.persona.seed : null;
    if (pseed != null) {
      const generated = generatePersona(pseed, this.schema);
      Object.assign(this.schema, generated);
    }
    if (!Array.isArray(this.schema.variables) || !this.schema.variables.length)
      throw new Error('Animus: schema.variables must be a non-empty array');
    // Deep-clone baselines so _evalGrowth mutations don't corrupt the caller's object.
    this.schema = Object.assign({}, this.schema, { baselines: Object.assign({}, this.schema.baselines) });
    this.memoryPath = opts.memory || null;
    this.now = opts.now || (() => new Date());
    this.rng = opts.rng || Math.random;
    this.stepMs = (this.schema.step_minutes || 1) * 60000;
    this.db = this._load();
    this._applyBaselineShifts(); // re-apply any persisted growth shifts to in-memory schema
    this._prevCompileState = null; // session-only snapshot for trend detection
  }

  _load() {
    if (this.memoryPath && fs.existsSync(this.memoryPath)) {
      try {
        const db = JSON.parse(fs.readFileSync(this.memoryPath, 'utf8'));
        // migrate existing dbs to new fields
        if (!db.topicFreq)    db.topicFreq    = {};
        if (!db.triggerState) db.triggerState  = {};
        if (!db.growthApplied) db.growthApplied = {};
        if (!db.baselineShifts) db.baselineShifts = {};
        return db;
      }
      catch (e) { /* corrupt db: fall through to fresh state, never crash the host app */ }
    }
    const state = {};
    this.schema.variables.forEach(v => { state[v] = this.schema.baselines[v] != null ? this.schema.baselines[v] : 0.5; });
    return {
      state, noiseState: {}, lastTick: this.now().getTime(),
      memories: [], eventLog: [],
      topicFreq: {}, triggerState: {}, growthApplied: {}, baselineShifts: {}
    };
  }

  _save() {
    if (!this.memoryPath) return;
    const tmp = this.memoryPath + '.tmp';
    fs.mkdirSync(path.dirname(path.resolve(this.memoryPath)), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.memoryPath); // atomic-ish: never leave a half-written db
  }

  /** Advance state by wall-clock time elapsed since last tick (homeostasis/circadian/noise + triggers + growth). */
  tick(now) {
    now = now || this.now();
    const nowMs = now.getTime();
    const elapsed = nowMs - this.db.lastTick;
    let steps = Math.floor(elapsed / this.stepMs);
    if (steps <= 0) return this;
    if (steps > MAX_CATCHUP_STEPS) steps = MAX_CATCHUP_STEPS;
    let s = { state: this.db.state, noiseState: this.db.noiseState };
    for (let i = 0; i < steps; i++) {
      s = E.step(s.state, this.schema, { date: now, rng: this.rng, noiseState: s.noiseState });
    }
    this.db.state = s.state;
    this.db.noiseState = s.noiseState;
    this.db.lastTick = nowMs;
    this._evalTriggers(elapsed, nowMs);
    this._evalGrowth();
    this._save();
    return this;
  }

  /** Apply events (from parseEvents or your own app logic) as one kicked step. */
  apply(events) {
    const now = this.now();
    this.tick(now);
    const kicks = E.eventsToKicks(events, this.schema);
    const s = E.step(this.db.state, this.schema, { date: now, rng: this.rng, noiseState: this.db.noiseState, kicks });
    this.db.state = s.state;
    this.db.noiseState = s.noiseState;
    const nowMs = now.getTime();
    (events || []).forEach(e => this.db.eventLog.push({ t: nowMs, type: e.type, i: e.intensity != null ? e.intensity : 1 }));
    if (this.db.eventLog.length > 500) this.db.eventLog = this.db.eventLog.slice(-500);
    this._evalGrowth(); // re-check after events are logged so count-based rules can fire
    this._save();
    return this;
  }

  /** Store an episodic beat. Salience decays (halflife 7d); rehearsal = remember it again. */
  remember(text, salience) {
    this.db.memories.push({ text, salience: salience != null ? salience : 0.5, t: this.now().getTime() });
    if (this.db.memories.length > MEM_CAP) {
      this.db.memories.sort((a, b) => this._memWeight(b) - this._memWeight(a));
      this.db.memories = this.db.memories.slice(0, MEM_CAP);
    }
    this._save();
    return this;
  }

  /**
   * Log topics from a conversation turn. Call this after each LLM exchange with
   * a comma-separated string or array of topic words/phrases from the turn.
   * The engine tracks frequency × recency and surfaces the top ones automatically
   * in compile(). You never need to call remember() for conversational topics.
   *
   * @param {string|string[]} topics — e.g. "auth, onboarding" or ["auth","onboarding"]
   */
  gist(topics) {
    const now = this.now().getTime();
    const list = Array.isArray(topics)
      ? topics.map(t => String(t).trim()).filter(Boolean)
      : String(topics).split(/[,;]+/).map(t => t.trim()).filter(Boolean);
    list.forEach(t => {
      if (!this.db.topicFreq[t]) this.db.topicFreq[t] = { count: 0, lastSeen: 0 };
      this.db.topicFreq[t].count++;
      this.db.topicFreq[t].lastSeen = now;
    });
    // Prune to cap: keep highest-scored topics
    const keys = Object.keys(this.db.topicFreq);
    if (keys.length > TOPIC_CAP) {
      const sorted = keys.map(k => [k, this._topicScore(k, now)]).sort((a, b) => b[1] - a[1]);
      sorted.slice(TOPIC_CAP).forEach(([k]) => delete this.db.topicFreq[k]);
    }
    this._save();
    return this;
  }

  _topicScore(topic, now) {
    const e = this.db.topicFreq[topic];
    if (!e) return 0;
    const ageDays = ((now != null ? now : this.now().getTime()) - e.lastSeen) / 86400000;
    return e.count * Math.pow(0.5, ageDays / TOPIC_HALFLIFE_DAYS);
  }

  _memWeight(m) {
    const ageDays = (this.now().getTime() - m.t) / 86400000;
    return m.salience * Math.pow(0.5, ageDays / MEM_HALFLIFE_DAYS);
  }

  /**
   * Top N topics by frequency × recency, drawn from gist() calls and remember() beats.
   * This is what compile() injects — call directly to inspect what's surfacing.
   */
  topMemories(n) {
    n = n != null ? n : 3;
    const now = this.now().getTime();
    const candidates = [];
    Object.keys(this.db.topicFreq).forEach(t => {
      const score = this._topicScore(t, now);
      if (score > 0.05) candidates.push({ text: t, score });
    });
    this.db.memories.forEach(m => {
      const score = this._memWeight(m);
      if (score > 0.05) candidates.push({ text: m.text, score });
    });
    return candidates.sort((a, b) => b.score - a.score).slice(0, n).map(c => c.text);
  }

  /** Most salient surviving topic, or null. Kept for backward compat; topMemories() is richer. */
  topMemory() {
    return this.topMemories(1)[0] || null;
  }

  // ── Trigger system ─────────────────────────────────────────────────────────
  // Evaluates schema.triggers after each tick. Conditions: elapsed_days/hours,
  // variable thresholds, or event counts. Fires built-in or custom events automatically.

  _evalTriggers(elapsedMs, nowMs) {
    const triggers = this.schema.triggers;
    if (!triggers || !triggers.length) return;
    const ctx = {
      elapsed_days:  elapsedMs / 86400000,
      elapsed_hours: elapsedMs / 3600000,
      state:         this.db.state,
      eventCounts:   this._eventCounts()
    };
    const eventsToFire = [];
    triggers.forEach((trigger, i) => {
      const ts = this.db.triggerState[i] || {};
      const cooldownMs = (trigger.cooldown_steps != null ? trigger.cooldown_steps : 0) * this.stepMs;
      if (nowMs - (ts.lastFiredAt || 0) < cooldownMs) return;
      if (!evalCondition(trigger.condition, ctx)) return;
      const fires = Array.isArray(trigger.fire) ? trigger.fire : [trigger.fire];
      const intensity = trigger.intensity != null ? trigger.intensity : 1;
      fires.forEach(f => eventsToFire.push({ type: f, intensity }));
      this.db.triggerState[i] = { lastFiredAt: nowMs };
    });
    if (!eventsToFire.length) return;
    const kicks = E.eventsToKicks(eventsToFire, this.schema);
    const s = E.step(this.db.state, this.schema, { date: new Date(nowMs), rng: this.rng, noiseState: this.db.noiseState, kicks });
    this.db.state = s.state;
    this.db.noiseState = s.noiseState;
    eventsToFire.forEach(e => this.db.eventLog.push({ t: nowMs, type: e.type, i: e.intensity }));
    if (this.db.eventLog.length > 500) this.db.eventLog = this.db.eventLog.slice(-500);
  }

  // ── Growth system ──────────────────────────────────────────────────────────
  // Evaluates schema.growth.rules. Each rule fires once when its trigger condition
  // is met, permanently shifting schema.baselines. Changes persist in db.baselineShifts.

  _evalGrowth() {
    const rules = this.schema.growth && this.schema.growth.rules;
    if (!rules || !rules.length) return;
    const ctx = {
      elapsed_days: 0, elapsed_hours: 0,
      state: this.db.state,
      eventCounts: this._eventCounts()
    };
    rules.forEach((rule, i) => {
      if (this.db.growthApplied[i]) return;
      if (!evalCondition(rule.trigger, ctx)) return;
      for (const v in (rule.shifts || {})) {
        const delta = rule.shifts[v];
        this.schema.baselines[v] = Math.min(1, Math.max(0, (this.schema.baselines[v] || 0.5) + delta));
        this.db.baselineShifts[v] = (this.db.baselineShifts[v] || 0) + delta;
      }
      this.db.growthApplied[i] = true;
    });
  }

  // Re-apply persisted baseline shifts to the in-memory schema on load.
  _applyBaselineShifts() {
    const shifts = this.db.baselineShifts || {};
    for (const v in shifts) {
      this.schema.baselines[v] = Math.min(1, Math.max(0, (this.schema.baselines[v] || 0.5) + shifts[v]));
    }
  }

  _eventCounts() {
    const counts = {};
    (this.db.eventLog || []).forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
    return counts;
  }

  // ── Trend detection ────────────────────────────────────────────────────────
  // Compares current state to the snapshot saved at the previous compile() call.
  // Returns { variable: 'rising'|'falling' } for variables in clear motion (Δ > 0.03).

  _computeTrends() {
    const prev = this._prevCompileState;
    if (!prev) return {};
    const trends = {};
    this.schema.variables.forEach(v => {
      const delta = (this.db.state[v] || 0) - (prev[v] || 0);
      if (delta > 0.03) trends[v] = 'rising';
      else if (delta < -0.03) trends[v] = 'falling';
    });
    return trends;
  }

  /** The product: tick to now, compile state → the one paragraph the LLM sees. */
  compile() {
    this.tick();
    const trends = this._computeTrends();
    this._prevCompileState = Object.assign({}, this.db.state);
    const inject = !(this.schema.compiler && this.schema.compiler.memory_injection === false);
    const topics = inject ? this.topMemories(3) : [];
    const memory = topics.length === 0 ? null
      : topics.length === 1 ? topics[0]
      : topics.slice(0, -1).join(', ') + ' and ' + topics[topics.length - 1];
    return E.compile(this.db.state, this.schema, { date: this.now(), memory, trends });
  }

  /** Read-only copy of the live state vector. */
  state() { return Object.assign({}, this.db.state); }

  /** Extract [[event:intensity]] tags from LLM output. Unknown tags ignored. */
  parseEvents(text) { return E.parseEvents(text, this.schema); }

  /** LLM output with event tags removed — what you show the user. */
  cleanText(text) { return E.stripEventTags(text); }

  static parseEvents(text, schema) { return E.parseEvents(text, schema || {}); }
  static stripEventTags(text) { return E.stripEventTags(text); }
  /** Generate a full schema from a 32-bit integer seed. Optionally merge with a base schema. */
  static generatePersona(seed, base) { return generatePersona(seed, base); }
}

module.exports = { Animus, engine: E };
