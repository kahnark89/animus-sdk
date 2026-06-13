/* animus-sdk public API. Engine math lives in engine.js (pure); this file owns
 * persistence (JSON db), wall-clock ticking, and episodic memory. Zero deps. */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./engine');

const MEM_HALFLIFE_DAYS = 7;   // salience halves weekly unless rehearsed
const MEM_CAP = 200;           // beats, not a transcript
const MAX_CATCHUP_STEPS = 240; // returning after a week ≠ 10k steps

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
      try { return JSON.parse(fs.readFileSync(this.memoryPath, 'utf8')); }
      catch (e) { /* corrupt db: fall through to fresh state, never crash the host app */ }
    }
    const state = {};
    this.schema.variables.forEach(v => { state[v] = this.schema.baselines[v] != null ? this.schema.baselines[v] : 0.5; });
    return { state, noiseState: {}, lastTick: this.now().getTime(), memories: [], eventLog: [] };
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

  _memWeight(m) {
    const ageDays = (this.now().getTime() - m.t) / 86400000;
    return m.salience * Math.pow(0.5, ageDays / MEM_HALFLIFE_DAYS);
  }

  /** Most salient surviving memory, or null. */
  topMemory() {
    if (!this.db.memories.length) return null;
    const best = this.db.memories.reduce((a, b) => this._memWeight(a) >= this._memWeight(b) ? a : b);
    return this._memWeight(best) > 0.05 ? best.text : null;
  }

  /** The product: tick to now, compile state → the one paragraph the LLM sees. */
  compile() {
    this.tick();
    const inject = !(this.schema.compiler && this.schema.compiler.memory_injection === false);
    return E.compile(this.db.state, this.schema, { date: this.now(), memory: inject ? this.topMemory() : null });
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
