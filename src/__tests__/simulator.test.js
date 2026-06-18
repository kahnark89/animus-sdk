/**
 * animus-sdk simulator smoke + engine-contract regression suite.
 *
 * WHY THIS EXISTS
 * ---------------
 * `animus simulate` inlines the REAL src/engine.js into templates/simulator.html
 * and runs it in a browser. Twice this has shipped broken because nothing ever
 * executed it: first the v1 API (`E.step`, `E.BUILTIN_EVENTS`), then a v2 rewrite
 * that called `E.stepFirst`/`E.stepSecond` with the WRONG ARGUMENT ORDER (it
 * followed a stale contract in .genome/30_SELECTION.md instead of engine.js).
 * Unit tests stayed green because none of them ran the generated artifact.
 *
 * This suite closes that gap two ways:
 *   1. CONTRACT — call the engine with the exact argument order the simulator
 *      uses, and assert it returns well-formed, finite state. Fast, no DOM.
 *   2. SMOKE — build the simulator the same way bin/animus.js does (inline engine
 *      + schema), then execute its real <script> in a minimal DOM shim and drive
 *      the animation loop. Asserts it does not throw and actually produces output.
 *
 * Both the first-order path (template schema: no second_order) and the
 * second-order path (a generated persona: has second_order) are exercised.
 *
 * Zero dependencies — uses Node's built-in `vm`. Self-executing; exits non-zero
 * on failure so it slots into `npm test` and CI.
 *
 * Run: node src/__tests__/simulator.test.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const engine = require('../engine');
const { generatePersona } = require('../persona');
const { normalizeSchema } = require('../normalize');

process.env.ANIMUS_SILENT = '1';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write('  \u2713 ' + name + '\n'); passed++; }
  catch (e) { process.stdout.write('  \u2717 ' + name + '\n    ' + e.message + '\n'); failed++; }
}
function section(n) { process.stdout.write('\n\u2500\u2500 ' + n + ' \u2500\u2500\n'); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function isFiniteNum(x) { return typeof x === 'number' && Number.isFinite(x); }

const ROOT          = path.join(__dirname, '..', '..');
const ENGINE_PATH   = path.join(ROOT, 'src', 'engine.js');
const TEMPLATE_PATH = path.join(ROOT, 'templates', 'simulator.html');
const SCHEMA_PATH   = path.join(ROOT, 'templates', 'agent.schema.json');

const firstOrderSchema  = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')); // template: no second_order, raw (string peaks)
const secondOrderSchema = generatePersona(42);                              // generated: has second_order, engine-ready

// The engine assumes a NORMALIZED schema (numeric peaks, circadian.applies_to set);
// normalize.js is that boundary, and index.js / the simulator normalize before calling.
// Contract tests below isolate ARGUMENT ORDER, so they feed engine-ready schemas.
const firstOrderReady = normalizeSchema(firstOrderSchema);

// ─────────────────────────────────────────────────────────────────────────────
section('Engine call-signature contract (the order the simulator uses)');

function freshState(schema) {
  const state = {}, noiseState = {}, velocity = {};
  for (const v of engine.VARS) { state[v] = schema.baselines[v] ?? 0.5; noiseState[v] = 0; velocity[v] = 0; }
  return { state, noiseState, velocity };
}

test('stepFirst(state, noiseState, schema, nowMs, kicks) → finite {state, noiseState}', () => {
  const { state, noiseState } = freshState(firstOrderReady);
  const r = engine.stepFirst(state, noiseState, firstOrderReady, Date.now(), {});
  assert(r && r.state && r.noiseState, 'stepFirst must return { state, noiseState }');
  for (const v of engine.VARS) {
    assert(isFiniteNum(r.state[v]), `stepFirst state.${v} not finite — wrong arg order?`);
    assert(isFiniteNum(r.noiseState[v]), `stepFirst noiseState.${v} not finite`);
  }
});

test('stepSecond(state, velocityState, noiseState, schema, nowMs, kicks) → finite {state, velocityState, noiseState}', () => {
  const { state, noiseState, velocity } = freshState(secondOrderSchema);
  const r = engine.stepSecond(state, velocity, noiseState, secondOrderSchema, Date.now(), {});
  assert(r && r.state && r.noiseState, 'stepSecond must return { state, noiseState, velocityState }');
  assert(r.velocityState, 'stepSecond must return velocityState (NOT "velocity") — simulator reads r.velocityState');
  for (const v of engine.VARS) {
    assert(isFiniteNum(r.state[v]), `stepSecond state.${v} not finite — wrong arg order?`);
    assert(isFiniteNum(r.velocityState[v]), `stepSecond velocityState.${v} not finite`);
  }
});

test('compile(state, schema, nowMs) accepts a numeric timestamp and returns a non-empty string', () => {
  const { state } = freshState(firstOrderReady);
  const line = engine.compile(state, firstOrderReady, Date.now());
  assert(typeof line === 'string' && line.trim().length > 0, 'compile must return a non-empty string');
});

// ─────────────────────────────────────────────────────────────────────────────
section('Generated simulator runs headless without throwing');

// Build the simulator exactly as bin/animus.js `simulate()` does.
function buildSimulator(schema) {
  const engineSrc = fs.readFileSync(ENGINE_PATH, 'utf8');
  let html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  html = html.replace('/*__ENGINE__*/', () => engineSrc)
             .replace('/*__SCHEMA__*/', () => JSON.stringify(schema));
  // Extract the two <script> blocks in order: [0] = engine UMD, [1] = simulator logic.
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert(scripts.length >= 2, 'expected at least two <script> blocks in the built simulator');
  return { engineScript: scripts[0], logicScript: scripts[1] };
}

// Minimal DOM/window shim — generous Proxies so any unanticipated DOM call is a no-op
// rather than a false failure. Methods return no-ops; data props have sane defaults.
function makeCtx2d() {
  return new Proxy({ strokeStyle: '', fillStyle: '', lineWidth: 1 }, {
    get(t, p) { return (p in t) ? t[p] : (() => {}); },
    set(t, p, v) { t[p] = v; return true; },
  });
}
function makeElement(id) {
  const ctx = makeCtx2d();
  const store = {
    id, textContent: '', innerHTML: '', className: '',
    value: id === 'speed' ? '50' : (id === 'lam' ? '0.08' : ''),
    width: 600, height: 300, offsetWidth: 600, offsetHeight: 300,
    style: {},
  };
  return new Proxy(store, {
    get(t, p) {
      if (p === 'getContext')   return () => ctx;
      if (p === 'appendChild')  return (c) => c;
      if (p === 'addEventListener') return () => {};
      if (p in t) return t[p];
      return () => {};                 // unknown method → no-op
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

// Run the built simulator in a fresh vm context, drive N animation frames, and
// fire the refresh interval. Returns the compiled mood-line and a sample value cell.
function runSimulatorHeadless(schema, frames) {
  const { engineScript, logicScript } = buildSimulator(schema);

  const elements = {};
  let clock = 0;
  const rafQueue = [];
  const intervalCbs = [];

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    performance: { now: () => clock },
    requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
    cancelAnimationFrame: () => {},
    setInterval: (cb) => { intervalCbs.push(cb); return intervalCbs.length; },
    clearInterval: () => {},
    document: {
      getElementById: (id) => (elements[id] || (elements[id] = makeElement(id))),
      createElement: (tag) => makeElement('_' + tag + '_' + Math.random().toString(36).slice(2)),
    },
    Math, Date, JSON, Object, Array, String, Number, Boolean, isNaN, isFinite, parseFloat, parseInt,
  };
  sandbox.window = sandbox;           // window.AnimusEngine === globalThis.AnimusEngine
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(engineScript, context, { filename: 'engine.js' });
  vm.runInContext(logicScript,  context, { filename: 'simulator-logic.js' });
  // init already ran refresh() once (compiles a mood-line) and queued loop once.

  // Drive frames: take the queued loop, advance the clock 1s, invoke it. It re-queues itself.
  for (let i = 0; i < frames; i++) {
    const cb = rafQueue.shift();
    if (!cb) break;
    clock += 1000;
    cb(clock);                        // throws here if the engine call order is wrong
  }
  // Fire the periodic refresh so the mood-line reflects the advanced state.
  for (const cb of intervalCbs) cb();

  return {
    moodLine: elements['mltext'] ? elements['mltext'].textContent : '',
    moodCell: elements['val-mood'] ? elements['val-mood'].textContent : '',
    framesDriven: frames,
  };
}

test('first-order path (template schema, no second_order) runs ~25 frames and emits a mood-line', () => {
  const out = runSimulatorHeadless(firstOrderSchema, 25);
  assert(typeof out.moodLine === 'string' && out.moodLine.trim().length > 0,
    'simulator produced no compiled mood-line — the run likely threw or compile failed');
  assert(/[a-z]/i.test(out.moodLine), 'mood-line should contain words, got: ' + JSON.stringify(out.moodLine));
  assert(/\d\.\d{2}\s+\w/.test(out.moodCell),
    'value cell should read like "0.xx <band>" (proves draw()+band5 ran), got: ' + JSON.stringify(out.moodCell));
});

test('second-order path (generated persona, has second_order) runs ~25 frames without throwing', () => {
  assert(secondOrderSchema.second_order, 'fixture must have second_order to exercise stepSecond');
  const out = runSimulatorHeadless(secondOrderSchema, 25);
  assert(typeof out.moodLine === 'string' && out.moodLine.trim().length > 0,
    'second-order simulator produced no mood-line — stepSecond likely threw (arg order / velocityState)');
});

test('built simulator contains NO stale v1 engine calls', () => {
  const html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  for (const stale of ['E.step(', 'E.BUILTIN_EVENTS', 'E.band(', 'SCHEMA.variables']) {
    assert(!html.includes(stale), `simulator template still references stale API: ${stale}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
process.stdout.write(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) { process.stdout.write('Simulator verification FAILED.\n'); process.exit(1); }
process.stdout.write('Simulator verified: generated artifact runs against the real engine.\n');
