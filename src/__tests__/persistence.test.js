/**
 * animus-sdk persistence + store regression suite.
 *
 * Guards the P1 persistence rework:
 *   - write-behind ('async' default) is off the hot path but still durable
 *   - cross-instance reads on the same target are correct (flush-on-construct)
 *   - save:'sync' and save:false modes behave as documented
 *   - FileStore is atomic, compact, and corruption-preserving
 *   - MemoryStore round-trips; custom async stores work via Animus.open()
 *   - a sync constructor refuses an async store with a clear error
 *   - exit-flush handlers are process-global (no per-instance listener leak)
 *
 * Run: node src/__tests__/persistence.test.js   (self-executing, exits non-zero on failure)
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { Animus, FileStore, MemoryStore, defaultMemoryPath } = require('../index');

process.env.ANIMUS_SILENT = '1';

let passed = 0, failed = 0;
function test(name, fn) { return Promise.resolve().then(fn)
  .then(() => { process.stdout.write('  \u2713 ' + name + '\n'); passed++; })
  .catch((e) => { process.stdout.write('  \u2717 ' + name + '\n    ' + e.message + '\n'); failed++; }); }
function section(n) { process.stdout.write('\n\u2500\u2500 ' + n + ' \u2500\u2500\n'); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function close(v, x, e = 1e-9) { return Math.abs(v - x) < e; }
function tmp() { return path.join(os.tmpdir(), `animus-pz-${process.pid}-${Math.random().toString(36).slice(2)}.json`); }
const tick = () => new Promise(r => setImmediate(r));

async function main() {
  section('Write-behind (default async mode)');

  await test('cross-instance, same tick, no explicit flush — reads fresh state', () => {
    const p = tmp();
    const a = Animus.create(42, { memoryPath: p });
    a.apply('wonderful! [[delight:0.9]]');
    const b = new Animus({ seed: 42, memoryPath: p }); // same target, same tick
    assert(close(b.state.mood, a.state.mood), `b.mood ${b.state.mood} != a.mood ${a.state.mood}`);
  });

  await test('flush() persists to disk and resolves', async () => {
    const p = tmp();
    const a = Animus.create(7, { memoryPath: p });
    a.apply('great work! [[praise:0.8]]');
    await a.flush();
    assert(fs.existsSync(p), 'file not written after flush()');
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert(close(raw.state.mood, a.state.mood), 'persisted mood mismatch');
  });

  await test('state file is compact JSON, not pretty-printed', async () => {
    const p = tmp();
    const a = Animus.create(8, { memoryPath: p });
    a.apply('hi [[reunion:0.4]]');
    await a.flush();
    assert(!fs.readFileSync(p, 'utf8').includes('\n  '), 'expected compact JSON');
  });

  await test('a turn\u2019s several mutations coalesce into the same write-behind window', async () => {
    const p = tmp();
    const a = Animus.create(11, { memoryPath: p });
    a.compile(); a.apply('nice [[delight:0.3]]'); a.gist('weather, plans'); a.remember('met up', 0.6);
    // still pending within this tick
    assert(a._dirty === true || a._flushTimer !== null, 'expected a pending coalesced write');
    await a.flush();
    assert(fs.existsSync(p), 'state not persisted');
  });

  section('Save modes');

  await test("save:false buffers — nothing written until flush()/export()", async () => {
    const p = tmp();
    const a = new Animus({ seed: 1, memoryPath: p, save: false });
    a.apply('hello [[reunion:0.5]]');
    await tick();
    assert(!fs.existsSync(p), 'save:false must not auto-write');
    assert(a.export().db.state, 'export() should still return state');
    await a.flush();
    assert(fs.existsSync(p), 'explicit flush() should write');
  });

  await test("save:'sync' writes synchronously (no flush needed)", () => {
    const p = tmp();
    const a = new Animus({ seed: 5, memoryPath: p, save: 'sync' });
    a.apply('hi [[reunion:0.4]]');
    assert(fs.existsSync(p), 'save:sync must persist immediately');
  });

  section('FileStore');

  await test('round-trips a db', async () => {
    const p = tmp();
    const store = new FileStore({ path: p });
    await store.save('k', { hello: 'world', n: 1 });
    assert(JSON.stringify(store.load('k')) === JSON.stringify({ hello: 'world', n: 1 }), 'round-trip mismatch');
  });

  await test('preserves a corrupt file as .corrupt-* instead of discarding it', () => {
    const p = tmp();
    fs.writeFileSync(p, '{ not valid json ', 'utf8');
    const store = new FileStore({ path: p });
    assert(store.load('k') === null, 'corrupt load should return null');
    const preserved = fs.readdirSync(path.dirname(p)).some(f => f.startsWith(path.basename(p) + '.corrupt-'));
    assert(preserved, 'corrupt file was not preserved');
  });

  await test('dir mode writes one sanitized file per key', async () => {
    const dir = path.join(os.tmpdir(), `animus-dir-${process.pid}-${Math.random().toString(36).slice(2)}`);
    const store = new FileStore({ dir });
    await store.save('user:42', { x: 1 });
    assert(fs.existsSync(path.join(dir, 'user_42.json')), 'expected sanitized per-key file');
  });

  section('MemoryStore + custom async store');

  await test('MemoryStore round-trips to a fresh instance', () => {
    const store = new MemoryStore();
    const a = new Animus({ seed: 99, store });
    a.apply('amazing! [[delight:1.0]]');
    a.flushSync();
    const b = new Animus({ seed: 99, store });
    assert(close(b.state.mood, a.state.mood), 'MemoryStore did not round-trip');
  });

  await test('new Animus() refuses an async store with a clear error', () => {
    const asyncStore = { load: () => Promise.resolve(null), save: () => Promise.resolve() };
    let msg = '';
    try { new Animus({ seed: 3, store: asyncStore }); } catch (e) { msg = e.message; }
    assert(/Animus\.open/.test(msg), `expected guidance toward Animus.open(), got: ${msg}`);
  });

  await test('Animus.open() round-trips through an async store', async () => {
    const backing = new Map();
    const asyncStore = {
      targetKey: k => 'async:' + k,
      load: k => new Promise(r => setTimeout(() => r(backing.has(k) ? JSON.parse(backing.get(k)) : null), 3)),
      save: (k, db) => new Promise(r => setTimeout(() => { backing.set(k, JSON.stringify(db)); r(); }, 3)),
    };
    const a = await Animus.open({ seed: 3, store: asyncStore });
    a.apply('so good [[delight:0.9]]');
    await a.flush();
    const b = await Animus.open({ seed: 3, store: asyncStore });
    assert(close(b.state.mood, a.state.mood), 'async store did not round-trip via open()');
  });

  section('Optimistic concurrency (multi-writer)');

  const { AnimusConflictError } = require('../index');

  await test('rev increments on each successful flush', async () => {
    const store = new MemoryStore();
    const a = new Animus({ seed: 1, store });
    const revs = [];
    for (let i = 0; i < 3; i++) { a.apply('hi [[delight:0.3]]'); await a.flush(); revs.push(a.db.rev); }
    assert(revs.join(',') === '1,2,3', `expected 1,2,3 got ${revs.join(',')}`);
  });

  await test("default policy throws AnimusConflictError on a concurrent write", async () => {
    const store = new MemoryStore();
    const a = new Animus({ seed: 2, store });
    const b = new Animus({ seed: 2, store });          // both loaded rev 0
    a.apply('great [[praise:0.7]]'); await a.flush();  // → rev 1
    b.apply('hi [[reunion:0.5]]');
    let err = null;
    try { await b.flush(); } catch (e) { err = e; }
    assert(err instanceof AnimusConflictError, 'expected AnimusConflictError');
    assert(err.expectedRev === 0 && err.currentRev === 1, `revs wrong: had ${err.expectedRev}, store ${err.currentRev}`);
    b.close();
  });

  await test("onConflict:'reload' adopts remote state without throwing", async () => {
    const store = new MemoryStore();
    const a = new Animus({ seed: 3, store });
    const b = new Animus({ seed: 3, store, onConflict: 'reload' });
    a.apply('amazing [[delight:1.0]]'); await a.flush();
    const aMood = a.state.mood;
    b.apply('meh [[boredom:0.5]]');
    let threw = false;
    try { await b.flush(); } catch { threw = true; }
    assert(!threw, "reload must not throw");
    assert(close(b.state.mood, aMood), 'reload did not adopt remote state');
    b.apply('ok [[praise:0.4]]'); await b.flush();
    assert(b.db.rev >= 2, 'B could not write after reload');
  });

  await test('onConflict merge function resolves with one retry', async () => {
    const store = new MemoryStore();
    let calls = 0;
    const merge = (local, remote) => { calls++; const out = JSON.parse(JSON.stringify(remote));
      out.state.mood = Math.max(local.state.mood, remote.state.mood); return out; };
    const a = new Animus({ seed: 4, store });
    const b = new Animus({ seed: 4, store, onConflict: merge });
    a.apply('good [[praise:0.6]]'); await a.flush();
    b.apply('joy [[delight:0.9]]');
    await b.flush();
    assert(calls === 1, `merge called ${calls} times, expected 1`);
    assert(b.db.rev === 2, `merged write should be rev 2, got ${b.db.rev}`);
  });

  await test('FileStore enforces CAS on disk between two instances', async () => {
    const p = tmp();
    const a = new Animus({ seed: 5, memoryPath: p });
    const b = new Animus({ seed: 5, memoryPath: p });
    a.apply('hi [[delight:0.5]]'); await a.flush();
    b.apply('yo [[reunion:0.5]]');
    let err = null;
    try { await b.flush(); } catch (e) { err = e; }
    assert(err instanceof AnimusConflictError, 'expected disk CAS conflict');
    b.close();
  });

  await test('a single writer never conflicts across many turns', async () => {
    const p = tmp();
    const a = new Animus({ seed: 6, memoryPath: p });
    for (let i = 0; i < 10; i++) { a.compile(); a.apply('x [[delight:0.2]]'); await a.flush(); }
    assert(a.db.rev >= 10, 'rev did not advance over 10 turns');
  });

  section('Resource hygiene');

  await test('exit-flush handlers are process-global (no per-instance leak)', () => {
    const before = process.listenerCount('exit');
    for (let i = 0; i < 50; i++) {
      const a = new Animus({ seed: 2000 + i, memoryPath: tmp() });
      a.apply('x [[delight:0.2]]');
    }
    const after = process.listenerCount('exit');
    assert(after - before <= 1, `exit listeners grew by ${after - before} across 50 instances`);
  });

  await test('defaultMemoryPath matches the constructor default', () => {
    const a = new Animus({ seed: 123 }); // no memoryPath
    const expected = defaultMemoryPath(a.schema);
    assert(a.memoryPath === expected, `${a.memoryPath} != ${expected}`);
    a.close();
  });

  process.stdout.write(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) { process.stdout.write('Persistence regression FAILED.\n'); process.exit(1); }
  process.stdout.write('Persistence layer verified.\n');
}

main();
