/* animus-sdk public API. Engine math lives in engine.js (pure); this file owns
 * persistence (JSON db), wall-clock ticking, and episodic memory. Zero deps. */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./engine');

const MEM_HALFLIFE_DAYS = 7;    // salience halves weekly unless rehearsed
const MEM_CAP = 200;            // beats, not a transcript
const MAX_CATCHUP_STEPS = 240;  // returning after a week ≠ 10k steps
const TOPIC_CAP = 500;          // distinct topics tracked before pruning
const TOPIC_HALFLIFE_DAYS = 7;  // frequency weight halves weekly

class Animus {
  /** @param {{schema: string|object, memory?: string, now?: () => Date, rng?: () => number}} opts */
  constructor(opts) {
    if (!opts || !opts.schema) throw new Error('Animus: { schema } is required');
    this.schema = typeof opts.schema === 'string'
      ? JSON.parse(fs.readFileSync(opts.schema, 'utf8'))
      : opts.schema;
    if (!Array.isArray(this.schema.variables) || !this.schema.variables.length)
      throw new Error('Animus: schema.variables must be a non-empty array');
    this.memoryPath = opts.memory || null;
    this.now = opts.now || (() => new Date());
    this.rng = opts.rng || Math.random;
    this.stepMs = (this.schema.step_minutes || 1) * 60000;
    this.db = this._load();
  }

  _load() {
    if (this.memoryPath && fs.existsSync(this.memoryPath)) {
      try {
        const db = JSON.parse(fs.readFileSync(this.memoryPath, 'utf8'));
        if (!db.topicFreq) db.topicFreq = {}; // migrate existing dbs
        return db;
      }
      catch (e) { /* corrupt db: fall through to fresh state, never crash the host app */ }
    }
    const state = {};
    this.schema.variables.forEach(v => { state[v] = this.schema.baselines[v] != null ? this.schema.baselines[v] : 0.5; });
    return { state, noiseState: {}, lastTick: this.now().getTime(), memories: [], eventLog: [], topicFreq: {} };
  }

  _save() {
    if (!this.memoryPath) return;
    const tmp = this.memoryPath + '.tmp';
    fs.mkdirSync(path.dirname(path.resolve(this.memoryPath)), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.memoryPath); // atomic-ish: never leave a half-written db
  }

  /** Advance state by wall-clock time elapsed since last tick (homeostasis/circadian/noise only). */
  tick(now) {
    now = now || this.now();
    const elapsed = now.getTime() - this.db.lastTick;
    let steps = Math.floor(elapsed / this.stepMs);
    if (steps <= 0) return this;
    if (steps > MAX_CATCHUP_STEPS) steps = MAX_CATCHUP_STEPS;
    let s = { state: this.db.state, noiseState: this.db.noiseState };
    for (let i = 0; i < steps; i++) {
      s = E.step(s.state, this.schema, { date: now, rng: this.rng, noiseState: s.noiseState });
    }
    this.db.state = s.state;
    this.db.noiseState = s.noiseState;
    this.db.lastTick = now.getTime();
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
    (events || []).forEach(e => this.db.eventLog.push({ t: now.getTime(), type: e.type, i: e.intensity != null ? e.intensity : 1 }));
    if (this.db.eventLog.length > 500) this.db.eventLog = this.db.eventLog.slice(-500);
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
    if (!this.db.topicFreq) this.db.topicFreq = {};
    list.forEach(t => {
      if (!this.db.topicFreq[t]) this.db.topicFreq[t] = { count: 0, lastSeen: 0 };
      this.db.topicFreq[t].count++;
      this.db.topicFreq[t].lastSeen = now;
    });
    // Prune to cap: drop lowest-scored topics
    const keys = Object.keys(this.db.topicFreq);
    if (keys.length > TOPIC_CAP) {
      const sorted = keys.map(k => [k, this._topicScore(k, now)]).sort((a, b) => b[1] - a[1]);
      sorted.slice(TOPIC_CAP).forEach(([k]) => delete this.db.topicFreq[k]);
    }
    this._save();
    return this;
  }

  _topicScore(topic, now) {
    const e = (this.db.topicFreq || {})[topic];
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
   * This is what compile() injects — you can also call it directly to inspect.
   */
  topMemories(n) {
    n = n != null ? n : 3;
    const now = this.now().getTime();
    const candidates = [];
    Object.keys(this.db.topicFreq || {}).forEach(t => {
      const score = this._topicScore(t, now);
      if (score > 0.05) candidates.push({ text: t, score });
    });
    this.db.memories.forEach(m => {
      const score = this._memWeight(m);
      if (score > 0.05) candidates.push({ text: m.text, score });
    });
    return candidates.sort((a, b) => b.score - a.score).slice(0, n).map(c => c.text);
  }

  /** Most salient surviving memory, or null. Kept for backward compat; topMemories() is richer. */
  topMemory() {
    return this.topMemories(1)[0] || null;
  }

  /** The product: tick to now, compile state → the one paragraph the LLM sees. */
  compile() {
    this.tick();
    const inject = !(this.schema.compiler && this.schema.compiler.memory_injection === false);
    const topics = inject ? this.topMemories(3) : [];
    const memory = topics.length === 0 ? null
      : topics.length === 1 ? topics[0]
      : topics.slice(0, -1).join(', ') + ' and ' + topics[topics.length - 1];
    return E.compile(this.db.state, this.schema, { date: this.now(), memory });
  }

  /** Read-only copy of the live state vector. */
  state() { return Object.assign({}, this.db.state); }

  /** Extract [[event:intensity]] tags from LLM output. Unknown tags ignored. */
  parseEvents(text) { return E.parseEvents(text, this.schema); }

  /** LLM output with event tags removed — what you show the user. */
  cleanText(text) { return E.stripEventTags(text); }

  static parseEvents(text, schema) { return E.parseEvents(text, schema || {}); }
  static stripEventTags(text) { return E.stripEventTags(text); }
}

module.exports = { Animus, engine: E };
