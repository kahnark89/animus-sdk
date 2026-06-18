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
 * @version 2.1.3
 * @license MIT
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const engine = require('./engine');
const { generatePersona } = require('./persona');
const { normalizeSchema, validateSchema } = require('./normalize');
const { FileStore, MemoryStore, isThenable } = require('./store');

// ─── Write-behind flush registry ──────────────────────────────────────────
// One process-wide handler flushes any still-dirty instance on exit. This is a
// single set of listeners (not one per Animus), so a server holding thousands of
// per-user instances never trips MaxListenersExceededWarning. Instances are only
// held here while dirty, and drop out the moment they flush — so they still GC.

const _dirtyByTarget = new Map(); // targetKey -> Set<Animus>
let _exitHooksInstalled = false;

function _registerDirty(inst) {
  let set = _dirtyByTarget.get(inst._targetKey);
  if (!set) { set = new Set(); _dirtyByTarget.set(inst._targetKey, set); }
  set.add(inst);
}
function _unregisterDirty(inst) {
  const set = _dirtyByTarget.get(inst._targetKey);
  if (set) { set.delete(inst); if (set.size === 0) _dirtyByTarget.delete(inst._targetKey); }
}
/** Synchronously flush any dirty instance writing to a given physical target. */
function _flushTargetSync(targetKey) {
  const set = _dirtyByTarget.get(targetKey);
  if (!set) return;
  for (const inst of [...set]) { try { inst.flushSync(); } catch { /* best effort */ } }
}
function _installExitHooks() {
  if (_exitHooksInstalled) return;
  _exitHooksInstalled = true;
  const flushAll = () => {
    for (const [, set] of _dirtyByTarget) {
      for (const inst of [...set]) { try { inst.flushSync(); } catch { /* best effort */ } }
    }
  };
  // `exit` is synchronous-only — FileStore.saveSync is synchronous, so this is safe
  // and covers process.exit(). `beforeExit` additionally covers natural drain.
  process.on('exit', flushAll);
  process.on('beforeExit', flushAll);
}

// ─── Defaults ─────────────────────────────────────────────────────────────

const DEFAULT_STEP_MINUTES = 1;
const MAX_TICK_STEPS       = 240;   // cap: 4 hours at 1 step/min
const MEMORY_HALFLIFE_DAYS = 7;
const TOPIC_HALFLIFE_DAYS  = 7;
const MAX_MEMORIES         = 200;
const MAX_TOPICS           = 500;

// ─── Conflict signaling ───────────────────────────────────────────────────

/**
 * Thrown by flush() (default conflict policy) when a CAS-capable store reports
 * that another writer advanced the same key since this instance loaded it.
 * Carries the key and revisions so the caller can reload and retry.
 */
class AnimusConflictError extends Error {
  constructor(key, expectedRev, currentRev) {
    super(`Animus: write conflict on "${key}" (had rev ${expectedRev}, store at ${currentRev == null ? '?' : currentRev}). ` +
          'Another writer updated this state. Reload and retry, route the key to a single writer, or set onConflict: \'reload\'.');
    this.name = 'AnimusConflictError';
    this.key = key;
    this.expectedRev = expectedRev;
    this.currentRev = currentRev;
  }
}

// ─── Animus class ─────────────────────────────────────────────────────────

class Animus {

  /**
   * @param {object} opts
   * @param {object|string} opts.schema   AnimusSchema object, or a path to a JSON schema file.
   * @param {number}  [opts.seed]         Generate the schema from a seed instead of passing one.
   * @param {string}  [opts.memoryPath]   Path to JSON state file. Defaults to .animus/{id}.json.
   * @param {string}  [opts.memory]       Alias for memoryPath.
   * @param {object}  [opts.store]        Custom persistence store (see store.js). Overrides memoryPath.
   *                                      If the store loads asynchronously, use `await Animus.open(opts)`.
   * @param {('async'|'sync'|false)} [opts.save]  Persistence mode (default 'async'):
   *                                      'async' = coalesced write-behind (off the hot path);
   *                                      'sync'  = write synchronously on every change;
   *                                      false   = never auto-save (you call flush()/export()).
   * @param {boolean} [opts.pretty]       Pretty-print the state file (default false / compact).
   * @param {boolean} [opts.infer]        Enable event inference fallback (default false).
   * @param {boolean} [opts.secondOrder]  Force second-order dynamics on/off; overrides schema.
   */
  constructor(opts = {}) {
    const r = opts.__resolved || Animus._resolve(opts);

    this.schema         = r.schema;
    this._baseBaselines = { ...this.schema.baselines }; // pristine copy — shifts applied on top, never accumulated
    this.infer          = r.infer;
    this.storeKey   = r.storeKey;
    this.memoryPath = r.memoryPath;   // retained for back-compat / tooling (default FileStore)
    this.store      = r.store;
    this.saveMode   = r.saveMode;

    this._targetKey  = (this.store.targetKey ? this.store.targetKey(this.storeKey) : ('store:' + this.storeKey));
    this._dirty      = false;
    this._flushTimer = null;
    this._conflictWarned = false;
    this._closed     = false;

    _installExitHooks();

    // If a sibling instance is writing the same physical target and is still
    // dirty (write-behind in flight), flush it now so our load reads fresh state.
    _flushTargetSync(this._targetKey);

    // Load existing state.
    let initial;
    if (opts._initialDb !== undefined) {
      initial = opts._initialDb;               // provided by Animus.open() (already awaited)
    } else {
      const loaded = this.store.load(this.storeKey);
      if (isThenable(loaded)) {
        throw new Error('Animus: this store loads asynchronously — use `await Animus.open({ store, schema })` instead of `new Animus(...)`.');
      }
      initial = loaded;
    }
    this.db = initial || this._freshDb();
    if (this.db.rev == null) this.db.rev = 0;
    this._rev = this.db.rev;                 // last revision this instance has seen
    this._conflictPolicy = r.conflictPolicy; // 'throw' | 'reload' | (local, remote) => merged
    this._applyBaselineShifts();

    // Social coupling registry: Map<animusInstance, strength>
    this._peers = [];
  }

  /**
   * Resolve constructor options into a concrete config (schema normalized +
   * validated once, store + key + save mode chosen). Shared by the constructor
   * and Animus.open() so resolution — and its warnings — happen exactly once.
   * @private
   */
  static _resolve(opts = {}) {
    let schema = opts.schema;
    if (schema == null && typeof opts.seed === 'number') schema = generatePersona(opts.seed);
    if (typeof schema === 'string') schema = JSON.parse(fs.readFileSync(schema, 'utf8'));
    if (!schema) {
      throw new Error('Animus: provide opts.schema (object or path) or opts.seed. Use Animus.create(seed) for auto-setup.');
    }

    schema = normalizeSchema(schema);
    validateSchema(schema);

    if (opts.secondOrder === true && !schema.second_order) {
      schema.second_order = { natural_freq: 0.08, damping_ratio: 0.90 };
    }
    if (opts.secondOrder === false) delete schema.second_order;

    const storeKey   = schema.id || 'default';
    const memoryPath = (opts.memoryPath ?? opts.memory)
      || path.join(process.cwd(), '.animus', `${storeKey}.json`);
    const store    = opts.store || new FileStore({ path: memoryPath, pretty: !!opts.pretty });
    const saveMode = (opts.save === undefined) ? 'async' : opts.save;
    const conflictPolicy = (opts.onConflict === undefined) ? 'throw' : opts.onConflict;
    if (conflictPolicy !== 'throw' && conflictPolicy !== 'reload' && typeof conflictPolicy !== 'function') {
      throw new Error("Animus: onConflict must be 'throw', 'reload', or a (local, remote) => mergedDb function.");
    }

    return { schema, infer: opts.infer ?? false, storeKey, memoryPath, store, saveMode, conflictPolicy };
  }

  // ─── Static factory — two-line cold start ──────────────────────────────

  /**
   * Animus.create(seed, opts?)
   * The one-liner entry point. Generates a persona from seed, loads state, ready.
   * Synchronous — works with the default FileStore and any synchronous store.
   *
   * @example
   *   const animus = Animus.create(42);
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

  /**
   * Animus.open(opts)
   * Async entry point for stores whose load() returns a Promise (Redis, Postgres, …).
   * Awaits the initial state load, then constructs. Also accepts `seed` instead of `schema`.
   *
   * @example
   *   const agent = await Animus.open({ schema, store: myRedisStore });
   *   const agent = await Animus.open({ seed: 42, store: myRedisStore });
   *
   * @param {object} opts  Same options as the constructor.
   * @returns {Promise<Animus>}
   */
  static async open(opts = {}) {
    const r = Animus._resolve(opts);
    const loaded = await Promise.resolve(r.store.load(r.storeKey));
    return new Animus({ ...opts, __resolved: r, _initialDb: loaded == null ? null : loaded });
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

    // Anti-repetition: avoid re-emitting a line we used in the last few turns.
    if (!this.db.recentLines) this.db.recentLines = [];
    const line = engine.compile(
      this.db.state, this.schema, Date.now(), prevState, mem,
      { recent: this.db.recentLines }
    );
    this.db.recentLines.push(line);
    if (this.db.recentLines.length > 6) this.db.recentLines.shift();

    this.db.prevState = Object.assign({}, this.db.state);
    this._markDirty();
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
      const extra = Object.keys(this.schema.events || {});
      evArr = engine.parseEvents(events, extra);
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
    this._markDirty();
    return this;
  }

  /**
   * Parse [[event:intensity]] tags from LLM response.
   * @param {string} text
   * @returns {object[]}
   */
  parseEvents(text) {
    const extra = Object.keys(this.schema.events || {});
    const tags = engine.parseEvents(text, extra);
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
    this._markDirty();
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
    this._markDirty();
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
    if (this.db.rev == null) this.db.rev = 0;
    this._rev = this.db.rev;   // adopt the imported revision as our baseline
    this._applyBaselineShifts();
    this._markDirty();
    return this;
  }

  // ─── Persistence control ──────────────────────────────────────────────

  /**
   * Persist now and resolve when the write completes.
   * In 'async' mode this drains the pending write-behind; safe to await at
   * request boundaries or before shutdown. No-op if nothing changed.
   *
   * If the store supports compare-and-set (FileStore/MemoryStore do), this uses
   * optimistic concurrency: a monotonic `rev` guards against a second writer
   * silently clobbering this key. On conflict the configured onConflict policy
   * runs — by default an AnimusConflictError is thrown so the caller can react.
   * @returns {Promise<void>}
   */
  flush() {
    if (this._flushTimer) { clearImmediate(this._flushTimer); this._flushTimer = null; }
    if (!this._dirty) return Promise.resolve();

    if (typeof this.store.cas === 'function') return this._casFlush(0);

    // No CAS on this store → last-write-wins (still bumps rev for observers).
    this._dirty = false;
    this.db.rev = (this._rev || 0) + 1;
    let r;
    try { r = this.store.save(this.storeKey, this.db); }
    catch (e) { this._dirty = true; return Promise.reject(e); }
    return Promise.resolve(r)
      .then(() => { this._rev = this.db.rev; this._conflictWarned = false; _unregisterDirty(this); })
      .catch((e) => { this._dirty = true; _registerDirty(this); throw e; });
  }

  /** @private optimistic-concurrency write with one optional merge-retry. */
  _casFlush(retries) {
    const expected = this._rev || 0;
    const next = expected + 1;
    this.db.rev = next;
    this._dirty = false;
    return Promise.resolve(this.store.cas(this.storeKey, this.db, expected)).then((res) => {
      if (res && res.ok) { this._rev = next; this._conflictWarned = false; _unregisterDirty(this); return; }
      this.db.rev = expected;                 // undo the optimistic bump
      return this._resolveConflict(res ? res.db : null, retries);
    }, (e) => { this._dirty = true; _registerDirty(this); throw e; });
  }

  /** @private apply the conflict policy. */
  _resolveConflict(remote, retries) {
    const policy = this._conflictPolicy;

    if (policy === 'reload') {
      if (remote) { this.db = remote; this._rev = remote.rev || 0; this._applyBaselineShifts(); }
      this._dirty = false; _unregisterDirty(this);
      if (!process.env.ANIMUS_SILENT) {
        console.warn(`[animus] write conflict on "${this.storeKey}" — reloaded remote state; the local turn was dropped.`);
      }
      return;
    }

    if (typeof policy === 'function' && retries < 1 && remote) {
      const merged = policy(this.db, remote);  // (local, remote) => mergedDb
      this.db = merged;
      this._rev = remote.rev || 0;
      this._applyBaselineShifts();
      this._dirty = true;
      return this._casFlush(retries + 1);      // retry once at the remote revision
    }

    this._dirty = true; _registerDirty(this);
    throw new AnimusConflictError(this.storeKey, this._rev, remote ? (remote.rev || 0) : null);
  }

  /**
   * Persist synchronously, best-effort. Used by the exit hooks and `save:'sync'`.
   * This path is last-write-wins (no CAS) — it exists to avoid losing unflushed
   * state at process exit. For optimistic-concurrency guarantees, await flush().
   * @returns {this}
   */
  flushSync() {
    if (this._flushTimer) { clearImmediate(this._flushTimer); this._flushTimer = null; }
    if (!this._dirty) return this;
    this._dirty = false;
    this.db.rev = (this._rev || 0) + 1;
    try {
      if (typeof this.store.saveSync === 'function') this.store.saveSync(this.storeKey, this.db);
      else this.store.save(this.storeKey, this.db);
      this._rev = this.db.rev;
    } catch (e) { this._dirty = true; throw e; }
    _unregisterDirty(this);
    return this;
  }

  /** Flush any pending write and stop auto-saving. Call when discarding an instance. */
  close() {
    try { this.flushSync(); } catch { /* best effort */ }
    this._closed = true;
    _unregisterDirty(this);
    return this;
  }

  // ─── Internal ─────────────────────────────────────────────────────────

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
      rev: 0,
    };
  }

  /**
   * Mark state dirty and persist according to saveMode.
   *   'sync'  → write through immediately (synchronous).
   *   'async' → coalesce: schedule a single write at the end of this tick, so a
   *             turn's several mutations collapse into one write off the hot path.
   *   false   → buffer only; caller persists via flush()/export().
   */
  _markDirty() {
    if (this._closed) return;
    this._dirty = true;

    if (this.saveMode === false) return;

    if (this.saveMode === 'sync') {
      try { this.flushSync(); }
      catch (e) { if (!process.env.ANIMUS_SILENT) console.warn('[animus] save failed: ' + e.message); }
      return;
    }

    // 'async' (default): coalesced write-behind
    _registerDirty(this);
    if (!this._flushTimer) {
      this._flushTimer = setImmediate(() => { this._flushTimer = null; this._flushBackground(); });
    }
  }

  _flushBackground() {
    this.flush().catch((e) => {
      if (process.env.ANIMUS_SILENT) return;
      if (e && e.name === 'AnimusConflictError') {
        if (!this._conflictWarned) {
          console.warn(`[animus] background write conflict on "${this.storeKey}" — holding local changes; ` +
                       'call await flush() to resolve per your onConflict policy.');
          this._conflictWarned = true;
        }
        return; // stays dirty; next explicit flush() (or markDirty) re-attempts
      }
      console.warn('[animus] background save failed: ' + e.message);
    });
  }

  _applyBaselineShifts() {
    const shifts = this.db.baselineShifts || {};
    for (const v of engine.VARS) {
      if (this._baseBaselines[v] !== undefined) {
        this.schema.baselines[v] = engine.clamp01(this._baseBaselines[v] + (shifts[v] || 0));
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

/**
 * The default on-disk state path for a given schema (or characterId), matching
 * what the constructor uses when no memoryPath/store is supplied. Shared with the
 * CLI so `animus status` looks exactly where the SDK writes.
 */
function defaultMemoryPath(schemaOrId, cwd = process.cwd()) {
  const id = (schemaOrId && typeof schemaOrId === 'object') ? (schemaOrId.id || 'default')
           : (schemaOrId || 'default');
  return path.join(cwd, '.animus', `${id}.json`);
}

module.exports = { Animus, AnimusConflictError, FileStore, MemoryStore, normalizeSchema, validateSchema, defaultMemoryPath };
