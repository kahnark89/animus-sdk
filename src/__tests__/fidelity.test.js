/**
 * animus-sdk feel & fidelity regression suite (P2).
 *
 *   - OU noise increments are true N(0,σ²): `magnitude` is an honest std-dev,
 *     and the 3σ cap still bounds them.
 *   - Set-point drift stays within ±max under Gaussian steps.
 *   - Compiler anti-repetition: deterministic without opts.recent; varied with it
 *     for multi-phrase personas; a graceful no-op for single-phrase compilers.
 *
 * Statistical checks use large N with generous tolerances to stay non-flaky.
 *
 * Run: node src/__tests__/fidelity.test.js   (self-executing, exits non-zero on failure)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const engine = require('../engine');
const { generatePersona } = require('../persona');

process.env.ANIMUS_SILENT = '1';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write('  \u2713 ' + name + '\n'); passed++; }
  catch (e) { process.stdout.write('  \u2717 ' + name + '\n    ' + e.message + '\n'); failed++; }
}
function section(n) { process.stdout.write('\n\u2500\u2500 ' + n + ' \u2500\u2500\n'); }
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

section('Gaussian noise (magnitude = σ)');

test('OU increments are ~N(0,σ²): mean≈0, sd≈σ, ~68% within 1σ', () => {
  const σ = 0.05;
  const schema = { noise: { magnitude: σ, autocorrelation: 0 } }; // ρ=0 → each step iid
  const ns = {}; for (const v of engine.VARS) ns[v] = 0;
  const xs = [];
  for (let i = 0; i < 40000; i++) xs.push(engine.stepNoise(ns, schema).mood);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  const within1 = xs.filter(x => Math.abs(x) <= σ).length / xs.length;
  assert(Math.abs(mean) < 0.005, `mean ${mean} not ~0`);
  assert(Math.abs(sd - σ) < σ * 0.12, `sd ${sd} not ~σ=${σ}`);
  assert(within1 > 0.63 && within1 < 0.73, `within-1σ ${within1.toFixed(3)} not ~0.68 (uniform would be ~0.58)`);
});

test('noise stays within the 3σ cap', () => {
  const σ = 0.05;
  const schema = { noise: { magnitude: σ, autocorrelation: 0.7 } };
  const ns = {}; for (const v of engine.VARS) ns[v] = 0;
  let maxAbs = 0;
  for (let i = 0; i < 40000; i++) {
    const out = engine.stepNoise(ns, schema);
    for (const v of engine.VARS) { ns[v] = out[v]; maxAbs = Math.max(maxAbs, Math.abs(out[v])); }
  }
  assert(maxAbs <= 3 * σ + 1e-9, `noise ${maxAbs} exceeded 3σ cap ${3 * σ}`);
});

test('set-point drift stays within ±max under Gaussian steps', () => {
  const cfg = { rate_per_day: 0.02, max: 0.1 };
  let shifts = {};
  for (let day = 0; day < 200; day++) {
    shifts = engine.driftSetpoints(shifts, cfg, 1);
    for (const v of Object.keys(shifts)) assert(Math.abs(shifts[v]) <= cfg.max + 1e-9, `drift ${shifts[v]} exceeded max`);
  }
});

section('Compiler anti-repetition');

const persona = generatePersona(42);
const stableState = { mood: 0.9, energy: 0.85, curiosity: 0.5, affection: 0.5, focus: 0.5 };
const now = new Date('2026-06-14T14:00:00').getTime();

test('deterministic (byte-identical) when opts.recent is omitted', () => {
  const a = engine.compile(stableState, persona, now, null, []);
  const b = engine.compile(stableState, persona, now, null, []);
  assert(a === b, 'expected identical output without anti-repetition');
});

test('varies across identical-state compiles when recent is supplied', () => {
  const recent = [];
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    const line = engine.compile(stableState, persona, now, null, [], { recent });
    recent.push(line);
    seen.add(line);
  }
  assert(seen.size >= 4, `expected ≥4 distinct lines, got ${seen.size}`);
});

test('graceful no-op for a single-phrase (hand-authored) compiler', () => {
  // Template flat compiler normalizes to single-element band pools → nothing to vary.
  const { normalizeSchema } = require('../normalize');
  const tmpl = normalizeSchema(JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../templates/agent.schema.json'), 'utf8')));
  const recent = [];
  let line1, line2;
  // identical state + single-phrase pools: anti-repetition can't vary, must not throw or loop
  line1 = engine.compile(stableState, tmpl, now, null, [], { recent }); recent.push(line1);
  line2 = engine.compile(stableState, tmpl, now, null, [], { recent });
  assert(typeof line2 === 'string' && line2.length > 0, 'single-phrase compile produced no line');
});

process.stdout.write(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) { process.stdout.write('Fidelity regression FAILED.\n'); process.exit(1); }
process.stdout.write('Fidelity layer verified.\n');
