#!/usr/bin/env node
/**
 * scripts/verify.js — independent, adversarial verification of animus-sdk.
 *
 * This does NOT trust the genome, the README, or any checkmark. It re-derives
 * the truth by executing code and by auditing documented claims against reality.
 * Exits non-zero if anything fails. Zero dependencies.
 *
 *   node scripts/verify.js        (or: npm run verify)
 *
 * Five independent gates:
 *   1. UNIT     — runs the full `npm test` suite (incl. the headless simulator).
 *   2. PHYSICS  — sweeps many seeds for many steps; asserts no NaN / divergence /
 *                 saturation. Re-proves the engine invariants from scratch.
 *   3. ARTIFACT — builds the simulator like the CLI and runs it headless. (Also
 *                 covered by simulator.test.js; repeated here so `verify` is a
 *                 complete standalone gate.)
 *   4. CLAIMS   — audits the genome's *numbers* against the code: phrase-corpus
 *                 size and test count must equal what 10_PHENOTYPE.md asserts.
 *   5. HYGIENE  — greps for the regressions we've already been bitten by:
 *                 stale simulator API, removed citation, broken adapter imports.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');

const ROOT = path.join(__dirname, '..');
const R = (...p) => path.join(ROOT, ...p);

let failures = 0;
const log  = (s='') => process.stdout.write(s + '\n');
const ok   = (s) => log('  \u2713 ' + s);
const bad  = (s) => { log('  \u2717 ' + s); failures++; };
const head = (n) => log('\n\u2550\u2550 ' + n + ' \u2550\u2550');

// ── Gate 1: unit + integration suite ─────────────────────────────────────────
head('1. UNIT + INTEGRATION (npm test)');
try {
  const out = cp.execSync('npm test --silent', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
  const results = [...out.matchAll(/Results:\s*(\d+)\s*passed,\s*(\d+)\s*failed/g)];
  const totalPass = results.reduce((a, m) => a + (+m[1]), 0);
  const totalFail = results.reduce((a, m) => a + (+m[2]), 0);
  if (totalFail === 0 && results.length >= 6) ok(`${totalPass} tests passed across ${results.length} suites, 0 failed`);
  else bad(`test suite reported ${totalFail} failures across ${results.length} suites`);
  global.__TEST_COUNT__ = totalPass;
} catch (e) {
  bad('npm test exited non-zero:\n' + (e.stdout || e.message));
  global.__TEST_COUNT__ = -1;
}

// ── Gate 2: physics invariants ───────────────────────────────────────────────
head('2. PHYSICS INVARIANTS (seed sweep, from scratch)');
try {
  const engine = require(R('src', 'engine'));
  const { generatePersona } = require(R('src', 'persona'));
  const SEEDS = 2000, STEPS = 2000;
  let nan = 0, diverge = 0, satHigh = 0, satLow = 0, coupledChecked = 0, coupledBad = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const schema = generatePersona(s);
    // independently re-verify the documented stability guarantee k_me*k_em < λ²
    if (schema.coupling.mood && schema.coupling.mood.energy) {
      coupledChecked++;
      const prod = schema.coupling.mood.energy * schema.coupling.energy.mood;
      if (prod >= schema.homeostasis_rate * schema.homeostasis_rate) coupledBad++;
    }
    const state = {}, vel = {}, noise = {};
    for (const v of engine.VARS) { state[v] = schema.baselines[v]; vel[v] = 0; noise[v] = 0; }
    let now = Date.UTC(2026, 0, 1, 9, 0, 0);
    let r = engine.runSteps(state, vel, noise, schema, now, 1, { mood:.4, energy:.4, curiosity:.4, affection:.4, focus:.4 });
    let st = r.state, ve = r.velocityState, no = r.noiseState;
    for (let i = 0; i < STEPS; i++) {
      r = engine.runSteps(st, ve, no, schema, now, 1, null);
      st = r.state; ve = r.velocityState; no = r.noiseState; now += 60000;
      let broke = false;
      for (const v of engine.VARS) {
        if (!Number.isFinite(st[v])) { nan++; broke = true; break; }
        if (Math.abs(ve[v]) > 0.5)   { diverge++; broke = true; break; }
      }
      if (broke) break;
    }
    let aH = true, aL = true;
    for (const v of engine.VARS) { if (st[v] < .999) aH = false; if (st[v] > .001) aL = false; }
    if (aH) satHigh++; if (aL) satLow++;
  }
  const clean = nan === 0 && diverge === 0 && satHigh === 0 && satLow === 0;
  (clean ? ok : bad)(`${SEEDS} seeds × ${STEPS} steps: nan=${nan} diverge=${diverge} satHigh=${satHigh} satLow=${satLow}`);
  (coupledBad === 0 ? ok : bad)(`stability guarantee k_me·k_em < λ² holds on ${coupledChecked} coupled seeds (${coupledBad} violations)`);
} catch (e) { bad('physics sweep threw: ' + e.message); }

// ── Gate 3: artifact runs ─────────────────────────────────────────────────────
head('3. ARTIFACT (build + run generated simulator headless)');
try {
  const vm = require('vm');
  const { generatePersona } = require(R('src', 'persona'));
  const engineSrc = fs.readFileSync(R('src', 'engine.js'), 'utf8');
  const template  = fs.readFileSync(R('templates', 'simulator.html'), 'utf8');

  function runHeadless(schema, label) {
    const html = template.replace('/*__ENGINE__*/', () => engineSrc)
                         .replace('/*__SCHEMA__*/', () => JSON.stringify(schema));
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    const els = {}; let clock = 0; const raf = [], iv = [];
    const ctx2d = () => new Proxy({ strokeStyle:'', lineWidth:1 }, { get:(t,p)=>p in t?t[p]:()=>{}, set:(t,p,v)=>{t[p]=v;return true;} });
    const el = (id) => { const c = ctx2d(); const st = { id, textContent:'', innerHTML:'', value:id==='speed'?'50':'0.08', width:600, height:300, offsetWidth:600, offsetHeight:300, style:{} };
      return new Proxy(st, { get:(t,p)=>p==='getContext'?()=>c:p==='appendChild'?(x)=>x:p in t?t[p]:()=>{}, set:(t,p,v)=>{t[p]=v;return true;} }); };
    const sb = { console:{log(){},warn(){},error(){}}, performance:{now:()=>clock},
      requestAnimationFrame:cb=>raf.push(cb), cancelAnimationFrame:()=>{}, setInterval:cb=>iv.push(cb), clearInterval:()=>{},
      document:{ getElementById:id=>els[id]||(els[id]=el(id)), createElement:t=>el('_'+t) },
      Math, Date, JSON, Object, Array, String, Number, Boolean, isNaN, isFinite, parseFloat, parseInt };
    sb.window = sb; sb.globalThis = sb;
    const c = vm.createContext(sb);
    vm.runInContext(scripts[0], c, { filename:'engine.js' });
    vm.runInContext(scripts[1], c, { filename:'logic.js' });
    for (let i = 0; i < 30; i++) { const cb = raf.shift(); if (!cb) break; clock += 1000; cb(clock); }
    for (const cb of iv) cb();
    const ml = els['mltext'] ? els['mltext'].textContent : '';
    if (!ml || !/[a-z]/i.test(ml)) throw new Error(`${label}: no mood-line produced`);
    return ml;
  }
  const a = runHeadless(JSON.parse(fs.readFileSync(R('templates','agent.schema.json'),'utf8')), 'first-order');
  ok('first-order simulator ran 30 frames: ' + JSON.stringify(a.slice(0, 60)));
  const b = runHeadless(generatePersona(42), 'second-order');
  ok('second-order simulator ran 30 frames: ' + JSON.stringify(b.slice(0, 60)));
} catch (e) { bad('generated simulator failed: ' + e.message); }

// ── Gate 4: audit genome NUMBERS against code ────────────────────────────────
head('4. CLAIM AUDIT (genome numbers vs reality)');
try {
  const { VOICE_REGISTERS } = require(R('src', 'persona'));
  let actualPhrases = 0;
  for (const reg of Object.keys(VOICE_REGISTERS))
    for (const v of Object.keys(VOICE_REGISTERS[reg]))
      for (const band of Object.keys(VOICE_REGISTERS[reg][v]))
        actualPhrases += VOICE_REGISTERS[reg][v][band].length;

  const phenotype = fs.readFileSync(R('.genome', '10_PHENOTYPE.md'), 'utf8');
  const claimedPhrases = (() => { const m = phenotype.match(/\*\*([\d,]+)\s*phrases\*\*/); return m ? +m[1].replace(/,/g,'') : null; })();
  if (claimedPhrases == null) bad('could not find a phrase-count claim in 10_PHENOTYPE.md to audit');
  else if (claimedPhrases === actualPhrases) ok(`phrase corpus: code has ${actualPhrases}, genome claims ${claimedPhrases} — match`);
  else bad(`phrase corpus MISMATCH: code has ${actualPhrases}, genome claims ${claimedPhrases}`);

  // latest row of the §6 test-count table
  const rows = [...phenotype.matchAll(/\|\s*v[\d.]+\s*\|\s*(\d+)\s*\|/g)];
  const claimedTests = rows.length ? +rows[rows.length - 1][1] : null;
  const actualTests = global.__TEST_COUNT__;
  if (actualTests < 0) bad('skipping test-count audit (suite did not run cleanly)');
  else if (claimedTests == null) bad('could not find a test-count row in 10_PHENOTYPE.md §6');
  else if (claimedTests === actualTests) ok(`test count: suite ran ${actualTests}, genome's latest row claims ${claimedTests} — match`);
  else bad(`test count MISMATCH: suite ran ${actualTests}, genome's latest row claims ${claimedTests}`);
} catch (e) { bad('claim audit threw: ' + e.message); }

// ── Gate 5: regression hygiene (the bugs we've already hit) ───────────────────
head('5. HYGIENE (known regressions stay fixed)');
function grepNone(file, needles, label) {
  const s = fs.readFileSync(R(file), 'utf8');
  const hits = needles.filter(n => s.includes(n));
  (hits.length === 0 ? ok : bad)(`${label}${hits.length ? ' — found: ' + hits.join(', ') : ''}`);
}
grepNone('templates/simulator.html', ['E.step(', 'E.BUILTIN_EVENTS', 'E.band(', 'SCHEMA.variables'], 'simulator.html free of stale v1 engine API');
grepNone('src/engine.js', ['Subaharan', '2601.16087'], 'engine.js free of the unverified citation');
grepNone('playground/index.html', ['Subaharan', '2601.16087'], 'playground free of the unverified citation');
for (const a of ['langchain', 'mem0', 'vercel-ai']) {
  const s = fs.readFileSync(R('examples', 'adapters', a, 'index.js'), 'utf8');
  // import EXAMPLES (require/from lines) must not use the stale @animus-sdk scope
  const badImport = /(require\(|from\s+)['"]@animus-sdk\//.test(s);
  (!badImport ? ok : bad)(`adapter example "${a}" has no @animus-sdk/* import statement`);
}

// ── Summary ──────────────────────────────────────────────────────────────────
log('\n' + '\u2500'.repeat(60));
if (failures === 0) { log('VERIFICATION PASSED — every gate green, every audited claim true.'); process.exit(0); }
log(`VERIFICATION FAILED — ${failures} check(s) failed above.`); process.exit(1);
