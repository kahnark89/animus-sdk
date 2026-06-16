/**
 * animus-sdk/src/store.js
 * Pluggable persistence layer.
 *
 * A Store is any object with this shape (sync OR async):
 *
 *   load(key)        -> db | null            (may return a Promise)
 *   save(key, db)    -> void                 (may return a Promise; non-blocking)
 *   saveSync(key,db) -> void                 (optional; used for crash-safe exit flush)
 *   targetKey(key)   -> string               (optional; identifies the physical target,
 *                                             so multiple Animus instances writing the
 *                                             same place can coordinate a flush)
 *
 * The default is FileStore. To back state with Redis/Postgres/S3/etc., implement
 * this interface and pass it as `new Animus({ store, schema })`. If your store
 * loads asynchronously, construct with `await Animus.open({ store, schema })`.
 *
 * @license MIT
 */

'use strict';

const fs   = require('fs');
const path = require('path');

function isThenable(x) { return !!x && typeof x.then === 'function'; }

/**
 * Atomic, concurrency-safe, corruption-preserving JSON-file store.
 *
 *  - Writes go to a per-process unique temp file, then atomic rename → no torn
 *    reads and no two instances clobbering the same .tmp.
 *  - A file that fails to parse is preserved as `<file>.corrupt-<ts>` instead of
 *    being silently discarded, so accumulated state is never lost without a trace.
 *  - `save()` is async (non-blocking) for the request hot path; `saveSync()` is
 *    used by the exit/`save:'sync'` paths.
 */
class FileStore {
  /**
   * @param {string|{path?:string,dir?:string,pretty?:boolean}} opts
   *   A single file path, or { path } for one file, or { dir } for one file per key.
   */
  constructor(opts = {}) {
    if (typeof opts === 'string') opts = { path: opts };
    this.filePath = opts.path || null;
    this.dir      = opts.dir  || null;
    this.pretty   = !!opts.pretty; // default: compact JSON (no human-read overhead)
    if (!this.filePath && !this.dir) {
      throw new Error('FileStore requires { path } (single file) or { dir } (one file per key).');
    }
  }

  _resolve(key) {
    if (this.filePath) return this.filePath;
    const safe = String(key).replace(/[^\w.-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }

  targetKey(key) { return path.resolve(this._resolve(key)); }

  load(key) {
    const p = this._resolve(key);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      try {
        const bak = `${p}.corrupt-${Date.now()}`;
        fs.renameSync(p, bak);
        if (!process.env.ANIMUS_SILENT) {
          console.warn(`[animus] state file ${p} was unreadable (${e.message}); preserved as ${path.basename(bak)} and starting fresh.`);
        }
      } catch { /* if we can't even move it, fall through and start fresh */ }
      return null;
    }
  }

  _serialize(db) { return this.pretty ? JSON.stringify(db, null, 2) : JSON.stringify(db); }
  _ensureDir(p)  { const d = path.dirname(p); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
  _tmp(p)        { return `${p}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`; }

  save(key, db) {
    const p = this._resolve(key);
    this._ensureDir(p);
    const data = this._serialize(db); // snapshot synchronously, write asynchronously
    const tmp = this._tmp(p);
    return fs.promises.writeFile(tmp, data, 'utf8')
      .then(() => fs.promises.rename(tmp, p))
      .catch(err => { fs.promises.unlink(tmp).catch(() => {}); throw err; });
  }

  saveSync(key, db) {
    const p = this._resolve(key);
    this._ensureDir(p);
    const tmp = this._tmp(p);
    fs.writeFileSync(tmp, this._serialize(db), 'utf8');
    fs.renameSync(tmp, p);
  }

  /**
   * Compare-and-set: write `db` only if the stored record's `rev` equals
   * `expectedRev` (or there is no record and expectedRev is 0). Returns
   * { ok:true, rev } on success, or { ok:false, db } with the current winner on
   * conflict. Synchronous and atomic *within a process*; across processes on a
   * plain filesystem there is a small read→write window — for true multi-process
   * safety back state with a store that has atomic CAS (Redis/Postgres).
   */
  cas(key, db, expectedRev) {
    const p = this._resolve(key);
    this._ensureDir(p);
    let current = null, currentRev = 0;
    if (fs.existsSync(p)) {
      try { current = JSON.parse(fs.readFileSync(p, 'utf8')); currentRev = current.rev || 0; }
      catch { current = null; currentRev = 0; } // unreadable → treat as empty (load() preserves it)
    }
    if (currentRev !== (expectedRev || 0)) return { ok: false, db: current };
    this.saveSync(key, db);
    return { ok: true, rev: db.rev };
  }
}

/**
 * In-process, ephemeral store. Useful for tests, short-lived workers, or when
 * you persist yourself via animus.export()/import(). Nothing survives the process.
 */
class MemoryStore {
  constructor() { this.map = new Map(); }
  targetKey(key) { return `memory:${key}`; }
  load(key) { return this.map.has(key) ? JSON.parse(JSON.stringify(this.map.get(key))) : null; }
  save(key, db) { this.map.set(key, JSON.parse(JSON.stringify(db))); }
  saveSync(key, db) { this.map.set(key, JSON.parse(JSON.stringify(db))); }
  cas(key, db, expectedRev) {
    const cur = this.map.has(key) ? JSON.parse(JSON.stringify(this.map.get(key))) : null;
    const curRev = cur ? (cur.rev || 0) : 0;
    if (curRev !== (expectedRev || 0)) return { ok: false, db: cur };
    this.map.set(key, JSON.parse(JSON.stringify(db)));
    return { ok: true, rev: db.rev };
  }
}

module.exports = { FileStore, MemoryStore, isThenable };
