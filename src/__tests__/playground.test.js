/**
 * animus-sdk playground build + smoke suite.
 *
 * WHY THIS EXISTS
 * ---------------
 * The playground used to embed its own reimplementation of the engine, which
 * could (and did) drift from src/engine.js. It has been rewired: the template
 * carries NO engine of its own, and `scripts/build-playground.js` inlines the
 * verbatim src/engine.js + src/persona.js. There is now exactly one engine in
 * the repo. This suite enforces that:
 *
 *   A. the template contains no embedded engine — only the production-API shim;
 *   B. a build inlines the EXACT src/engine.js and src/persona.js bytes;
 *   C. the built page runs headless against the real engine without throwing and
 *      renders a real production compile() mood-line into #moodLine;
 *   D. the committed playground/index.html and docs/index.html match a fresh
 *      build (so a stale commit is caught).
 *
 * Zero dependencies (Node's `vm`). Self-executing; exits non-zero on failure.
 *
 * Run: node src/__tests__/playground.test.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

process.env.ANIMUS_SILENT = '1';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write('  \u2713 ' + name + '\n'); passed++; }
  catch (e) { process.stdout.write('  \u2717 ' + name + '\n    ' + e.message + '\n'); failed++; }
}
function section(n) { process.stdout.write('\n\u2500\u2500 ' + n + ' \u2500\u2500\n'); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

const ROOT = path.join(__dirname, '..', '..');
const R = (...p) => path.join(ROOT, ...p);

const TEMPLATE   = R('playground', 'playground.template.html');
const ENGINE_SRC  = fs.readFileSync(R('src', 'engine.js'), 'utf8');
const PERSONA_SRC = fs.readFileSync(R('src', 'persona.js'), 'utf8');

// Build the playground in-memory exactly as scripts/build-playground.js does.
function buildPlayground() {
  let html = fs.readFileSync(TEMPLATE, 'utf8');
  return html.replace('/*__ENGINE__*/',  () => ENGINE_SRC)
             .replace('/*__PERSONA__*/', () => PERSONA_SRC);
}

// ── A. Template hygiene ───────────────────────────────────────────────────────
section('Template carries no engine of its own');

test('template has the engine + persona inline placeholders', () => {
  const t = fs.readFileSync(TEMPLATE, 'utf8');
  assert(t.includes('/*__ENGINE__*/'),  'missing /*__ENGINE__*/ placeholder');
  assert(t.includes('/*__PERSONA__*/'), 'missing /*__PERSONA__*/ placeholder');
});

test('template has no embedded engine reimplementation (only the production shim)', () => {
  const t = fs.readFileSync(TEMPLATE, 'utf8');
  // these were the embedded-engine internals; none should survive in the template
  for (const sym of ['function stepNoise(', 'function mulberry32(', 'function traitsFromSeed(',
                     'function effectiveBaseline(', 'FALLBACK_PHRASES']) {
    assert(!t.includes(sym), `template still embeds engine internal: ${sym}`);
  }
  // exactly one `function step(` — the shim adapter, not an engine
  assert((t.match(/function step\(/g) || []).length === 1, 'expected exactly one (shim) step()');
  assert(t.includes('window.AnimusEngine'), 'template must reference the inlined production engine');
});

// ── B. Build inlines the verbatim production source ───────────────────────────
section('Build inlines the exact production engine + persona');

test('built playground contains src/engine.js verbatim', () => {
  assert(buildPlayground().includes(ENGINE_SRC), 'built playground does not contain the exact engine.js bytes');
});

test('built playground contains src/persona.js verbatim', () => {
  assert(buildPlayground().includes(PERSONA_SRC), 'built playground does not contain the exact persona.js bytes');
});

// ── C. Built page runs headless on the real engine ────────────────────────────
section('Built playground runs headless against the real engine');

function runHeadless(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const els = {};
  let clock = 0; const raf = [], iv = [];
  const ctx2d = () => new Proxy({ strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', globalAlpha: 1 },
    { get: (t, p) => p in t ? t[p] : (() => {}), set: (t, p, v) => { t[p] = v; return true; } });
  const el = (id) => {
    const c = ctx2d();
    const st = { id, textContent: '', innerHTML: '', value: id === 'seed' ? '42' : '50',
      width: 600, height: 300, offsetWidth: 600, offsetHeight: 300, style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, dataset: {}, checked: false };
    return new Proxy(st, {
      get: (t, p) => p === 'getContext' ? () => c
        : p === 'appendChild' ? (x) => x
        : p === 'querySelector' ? () => el('_q')
        : p === 'querySelectorAll' ? () => []
        : p === 'addEventListener' ? () => {}
        : p in t ? t[p] : (() => {}),
      set: (t, p, v) => { t[p] = v; return true; },
    });
  };
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    performance: { now: () => clock },
    requestAnimationFrame: (cb) => raf.push(cb), cancelAnimationFrame: () => {},
    setInterval: (cb) => iv.push(cb), clearInterval: () => {},
    setTimeout: (cb) => { if (typeof cb === 'function') cb(); return 0; }, clearTimeout: () => {},
    location: { href: 'http://localhost/', search: '', hash: '' }, history: { replaceState() {}, pushState() {} },
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    document: { getElementById: (id) => els[id] || (els[id] = el(id)), createElement: (t) => el('_' + t),
      querySelector: () => el('_q'), querySelectorAll: () => [], addEventListener: () => {}, body: el('body') },
    URL, URLSearchParams, TextEncoder, TextDecoder,
    Math, Date, JSON, Object, Array, String, Number, Boolean, isNaN, isFinite, parseFloat, parseInt,
    encodeURIComponent, decodeURIComponent,
  };
  sb.window = sb; sb.globalThis = sb;
  const ctx = vm.createContext(sb);

  for (const s of scripts) vm.runInContext(s, ctx, { filename: 'playground.html' });
  for (let i = 0; i < 10; i++) { const cb = raf.shift(); if (!cb) break; clock += 1000; cb(clock); }
  for (const cb of iv) cb();
  return { sb, els };
}

test('built page executes without throwing and exposes the production engine globals', () => {
  const { sb } = runHeadless(buildPlayground());
  assert(sb.window.AnimusEngine && typeof sb.window.AnimusEngine.stepFirst === 'function',
    'inlined production AnimusEngine not present/functional');
  assert(sb.window.AnimusPersona && typeof sb.window.AnimusPersona.generatePersona === 'function',
    'inlined production AnimusPersona not present/functional');
});

test('renders a real production compile() mood-line into #moodLine', () => {
  const { els } = runHeadless(buildPlayground());
  const line = els['moodLine'] ? els['moodLine'].textContent : '';
  assert(typeof line === 'string' && line.trim().length > 0 && line.trim() !== '\u2014',
    'moodLine not populated — the UI did not reach the real compile() (got: ' + JSON.stringify(line) + ')');
  assert(/[a-z]/i.test(line), 'mood-line should contain words, got: ' + JSON.stringify(line));
});

// ── D. Committed artifacts are up-to-date with the template ───────────────────
section('Committed build outputs are not stale');

test('playground/index.html matches a fresh build (run `npm run build:playground` if this fails)', () => {
  const fresh = buildPlayground();
  const committed = fs.readFileSync(R('playground', 'index.html'), 'utf8');
  assert(committed === fresh, 'playground/index.html is stale — rebuild with `npm run build:playground`');
});

test('docs/index.html (Pages deploy) matches a fresh build', () => {
  const fresh = buildPlayground();
  const committed = fs.readFileSync(R('docs', 'index.html'), 'utf8');
  assert(committed === fresh, 'docs/index.html is stale — rebuild with `npm run build:playground`');
});

// ──────────────────────────────────────────────────────────────────────────────
process.stdout.write(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) { process.stdout.write('Playground verification FAILED.\n'); process.exit(1); }
process.stdout.write('Playground verified: runs the verbatim production engine; committed build is current.\n');
