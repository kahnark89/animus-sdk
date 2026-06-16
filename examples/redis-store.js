/**
 * examples/redis-store.js
 *
 * A per-user Animus store backed by Redis — the shape a companion product wants:
 * one Animus instance per user, state in Redis instead of a local file, zero
 * local disk footprint, horizontally scalable.
 *
 * This is illustrative. It uses the `ioredis` API but the Store contract is tiny —
 * any client (node-redis, Upstash, a Postgres pool, DynamoDB, S3) works the same way:
 *
 *   load(key)      -> db | null      (here: async — so construct with Animus.open)
 *   save(key, db)  -> Promise<void>  (non-blocking; Animus does not await it inline)
 *   saveSync?      -> (optional) best-effort synchronous flush at process exit
 *   targetKey?     -> (optional) identity for co-writing-instance coordination
 *
 * Usage:
 *   const Redis = require('ioredis');
 *   const { Animus } = require('animus-sdk');
 *   const { RedisStore } = require('./examples/redis-store');
 *
 *   const store = new RedisStore(new Redis(process.env.REDIS_URL), { prefix: 'animus:' });
 *
 *   // one agent per user — keyed by userId via the schema id
 *   const schema = generatePersona(hashUserIdToSeed(userId));
 *   schema.id = `user:${userId}`;
 *   const agent = await Animus.open({ schema, store });   // async store => open(), not new
 *
 *   const moodLine = agent.compile();
 *   // ... your LLM call ...
 *   agent.apply(replyText);
 *   await agent.flush();   // make the turn durable before responding
 */

'use strict';

class RedisStore {
  /**
   * @param {object} redis   An ioredis-like client with async get/set.
   * @param {object} [opts]  { prefix?: string, ttlSeconds?: number }
   */
  constructor(redis, opts = {}) {
    this.redis  = redis;
    this.prefix = opts.prefix || 'animus:';
    this.ttl    = opts.ttlSeconds || 0; // 0 = no expiry
  }

  _k(key) { return this.prefix + key; }

  targetKey(key) { return 'redis:' + this._k(key); }

  async load(key) {
    const raw = await this.redis.get(this._k(key));
    return raw ? JSON.parse(raw) : null;
  }

  async save(key, db) {
    const data = JSON.stringify(db);
    if (this.ttl > 0) await this.redis.set(this._k(key), data, 'EX', this.ttl);
    else await this.redis.set(this._k(key), data);
  }

  /**
   * Atomic compare-and-set via WATCH/MULTI/EXEC — this is what makes multi-writer
   * safe across processes (which a plain filesystem can't guarantee). Writes only
   * if the stored `rev` still equals expectedRev; otherwise returns the current
   * winner so Animus can apply your onConflict policy.
   */
  async cas(key, db, expectedRev) {
    const k = this._k(key);
    await this.redis.watch(k);
    const raw = await this.redis.get(k);
    const cur = raw ? JSON.parse(raw) : null;
    const curRev = cur ? (cur.rev || 0) : 0;
    if (curRev !== (expectedRev || 0)) { await this.redis.unwatch(); return { ok: false, db: cur }; }
    const tx = this.redis.multi();
    if (this.ttl > 0) tx.set(k, JSON.stringify(db), 'EX', this.ttl);
    else tx.set(k, JSON.stringify(db));
    const res = await tx.exec();           // null = key changed between WATCH and EXEC
    if (res === null) { const raw2 = await this.redis.get(k); return { ok: false, db: raw2 ? JSON.parse(raw2) : null }; }
    return { ok: true, rev: db.rev };
  }

  // No reliable synchronous Redis write exists, so there is no saveSync():
  // call `await agent.flush()` (or agent.close() after an awaited flush) at
  // request boundaries / graceful shutdown. The in-run write-behind already
  // persists each turn; only an abrupt SIGKILL can lose the last unflushed turn.
}

module.exports = { RedisStore };

/*
 * Postgres sketch (same contract, JSONB column):
 *
 *   class PgStore {
 *     constructor(pool) { this.pool = pool; }            // pg.Pool
 *     targetKey(key) { return 'pg:' + key; }
 *     async load(key) {
 *       const { rows } = await this.pool.query('SELECT db FROM animus_state WHERE id=$1', [key]);
 *       return rows[0] ? rows[0].db : null;
 *     }
 *     async save(key, db) {
 *       await this.pool.query(
 *         `INSERT INTO animus_state (id, db) VALUES ($1, $2)
 *          ON CONFLICT (id) DO UPDATE SET db = EXCLUDED.db`,
 *         [key, db]
 *       );
 *     }
 *     // Atomic CAS: the WHERE clause makes the update a no-op on a stale rev.
 *     async cas(key, db, expectedRev) {
 *       if ((expectedRev || 0) === 0) {
 *         const r = await this.pool.query(
 *           'INSERT INTO animus_state (id, db) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [key, db]);
 *         if (r.rowCount === 1) return { ok: true, rev: db.rev };
 *       } else {
 *         const r = await this.pool.query(
 *           `UPDATE animus_state SET db=$2 WHERE id=$1 AND (db->>'rev')::int = $3`,
 *           [key, db, expectedRev]);
 *         if (r.rowCount === 1) return { ok: true, rev: db.rev };
 *       }
 *       const { rows } = await this.pool.query('SELECT db FROM animus_state WHERE id=$1', [key]);
 *       return { ok: false, db: rows[0] ? rows[0].db : null };
 *     }
 *   }
 */
