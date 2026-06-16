/**
 * animus-sdk README / quickstart regression suite.
 *
 * Guards the documented happy path so it can never silently rot again:
 *   - the README quickstart constructor runs (schema path OR object; memory alias)
 *   - the scaffolded template (npx animus init) loads and compiles (init → run)
 *   - "HH:MM" circadian peaks produce a live rhythm, not a stuck floor
 *   - custom schema.events kick, both as structured events and [[tags]]
 *   - compiler.memory_injection:false is honored
 *   - the flat compiler form is honored
 *   - validateSchema fails loud on a broken schema and warns on dead triggers
 *   - Animus.create(seed) still works
 *
 * Run: node src/__tests__/readme.test.js   (self-executing, exits non-zero on failure)
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { Animus } = require('../index');
const engine     = require('../engine');
const { normalizeSchema, validateSchema } = require('../normalize');

const TEMPLATE_PATH = path.resolve(__dirname, '../../templates/agent.schema.json');

// ── tiny harness ──────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); process.stdout.write('  \u2713 ' + name + '\n'); passed++; }
  catch (e) { process.stdout.write('  \u2717 ' + name + '\n    ' + e.message + '\n'); failed++; }
}
function section(n) { process.stdout.write('\n\u2500\u2500 ' + n + ' \u2500\u2500\n'); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function tmpState() { return path.join(os.tmpdir(), `animus-readme-${process.pid}-${Math.random().toString(36).slice(2)}.json`); }

// Keep trigger no-op warnings out of the test output where irrelevant.
process.env.ANIMUS_SILENT = '1';

// ── Quickstart constructor ────────────────────────────────────────────────
section('README quickstart');

test('constructs from a schema PATH string (as scaffolded)', () => {
  const agent = new Animus({ schema: TEMPLATE_PATH, memoryPath: tmpState() });
  const mood = agent.compile();
  assert(typeof mood === 'string' && mood.length > 0, 'compile() did not return a mood-line');
});

test('constructs from a schema OBJECT', () => {
  const schema = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  const agent = new Animus({ schema, memoryPath: tmpState() });
  assert(agent.compile().length > 0, 'compile() empty');
});

test('accepts `memory` as an alias for `memoryPath`', () => {
  const p = tmpState();
  const agent = new Animus({ schema: TEMPLATE_PATH, memory: p });
  assert(agent.memoryPath === p, `expected memoryPath ${p}, got ${agent.memoryPath}`);
});

test('does not mutate the caller\u2019s schema object', () => {
  const schema = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  const before = JSON.stringify(schema);
  // eslint-disable-next-line no-new
  new Animus({ schema, memoryPath: tmpState() });
  assert(JSON.stringify(schema) === before, 'constructor mutated the input schema');
});

test('full before/after turn loop runs (mock LLM)', () => {
  const agent = new Animus({ schema: TEMPLATE_PATH, memoryPath: tmpState() });
  const moodLine = agent.compile();
  assert(moodLine.length > 0, 'no mood-line');
  // pretend an LLM replied with an event tag
  const reply = 'You fixed it! [[delight:0.9]]';
  const before = agent.state.mood;
  agent.apply(reply);
  assert(agent.state.mood > before, 'delight did not raise mood');
  assert(agent.cleanText(reply) === 'You fixed it!', 'cleanText did not strip the tag');
});

// ── init → run ────────────────────────────────────────────────────────────
section('Scaffolded template (npx animus init)');

test('template loads, normalizes, and compiles without throwing', () => {
  const agent = new Animus({ schema: TEMPLATE_PATH, memoryPath: tmpState() });
  const d = agent.diagnose();
  assert(d.variables.length === 5, 'expected 5 variables');
});

test('template triggers all fire a real (non-no-op) event', () => {
  const schema = normalizeSchema(JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8')));
  const known = engine.KICK_TABLE;
  for (const t of schema.triggers || []) {
    const inBuiltin = !!known[t.fire];
    const inCustom  = !!(schema.events && schema.events[t.fire]);
    assert(inBuiltin || inCustom, `template trigger fires unknown event "${t.fire}"`);
  }
});

// ── Circadian ─────────────────────────────────────────────────────────────
section('Circadian rhythm');

test('"HH:MM" peaks are coerced to numeric hours', () => {
  const s = normalizeSchema({ baselines: { mood: .5, energy: .5, curiosity: .5, affection: .5, focus: .5 },
    homeostasis_rate: 0.08, circadian: { peaks: ['09:00', '14:00'], floor: 0.15 } });
  assert(JSON.stringify(s.circadian.peaks) === '[9,14]', `peaks = ${JSON.stringify(s.circadian.peaks)}`);
  assert(Array.isArray(s.circadian.applies_to), 'applies_to was not defaulted');
});

test('circadian factor is live at peak, not stuck at the floor', () => {
  const circ = { peaks: [9, 14], floor: 0.15, sigma_hours: 2, applies_to: ['energy'] };
  const at9 = new Date(); at9.setHours(9, 0, 0, 0);
  const f = engine.circadianFactor(at9.getTime(), circ);
  assert(f > 0.9, `expected factor ~1 at 9am, got ${f} (NaN-collapse-to-floor regression)`);
});

// ── Custom events ─────────────────────────────────────────────────────────
section('Custom events');

function withCustomEvents() {
  const schema = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  schema.events = { breakthrough: { mood: 0.25, energy: 0.15, curiosity: -0.10 } };
  return schema;
}

test('custom event kicks via structured apply()', () => {
  const agent = new Animus({ schema: withCustomEvents(), memoryPath: tmpState() });
  const before = agent.state.mood;
  agent.apply([{ type: 'breakthrough', intensity: 1 }]);
  assert(agent.state.mood > before, 'custom event did not move mood');
});

test('custom event kicks via [[breakthrough]] text tag', () => {
  const agent = new Animus({ schema: withCustomEvents(), memoryPath: tmpState() });
  const parsed = agent.parseEvents('huge progress today [[breakthrough:0.8]]');
  assert(parsed.length === 1 && parsed[0].type === 'breakthrough', 'custom tag not parsed');
  const before = agent.state.mood;
  agent.apply('huge progress today [[breakthrough:0.8]]');
  assert(agent.state.mood > before, 'custom tag did not move mood');
});

test('built-in `confusion` event exists and lowers curiosity', () => {
  assert(engine.KICK_TABLE.confusion, 'confusion missing from KICK_TABLE');
  const k = engine.eventsToKicks([{ type: 'confusion', intensity: 1 }], { event_sensitivity: {} });
  assert(k.curiosity < 0, 'confusion did not lower curiosity');
});

// ── Compiler ──────────────────────────────────────────────────────────────
section('Compiler');

test('flat compiler band labels are honored', () => {
  const s = normalizeSchema(JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8')));
  // mood pinned high → template author wrote "bright and joyful" for the high band
  const line = engine.compile({ mood: 0.95, energy: 0.5, curiosity: 0.5, affection: 0.5, focus: 0.5 },
    s, Date.now(), null, []);
  assert(line.includes('bright and joyful'), `author phrase missing: ${line}`);
});

test('compiler.memory_injection:false suppresses the memory gist', () => {
  const s = normalizeSchema(JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8')));
  s.compiler.memory_injection = false;
  const line = engine.compile({ mood: .6, energy: .6, curiosity: .6, affection: .6, focus: .6 },
    s, Date.now(), null, ['the auth module']);
  assert(!line.includes('thinking about'), `memory leaked despite false: ${line}`);
});

// ── Validation ────────────────────────────────────────────────────────────
section('Schema validation');

test('throws an actionable error on a schema missing baselines', () => {
  let msg = '';
  try { validateSchema({ homeostasis_rate: 0.08, baselines: { mood: 0.5 } }); }
  catch (e) { msg = e.message; }
  assert(msg.includes('baselines.energy'), `error not actionable: ${msg}`);
});

test('warns (does not throw) on a trigger that fires an unknown event', () => {
  delete process.env.ANIMUS_SILENT;
  const warnings = [];
  const orig = console.warn; console.warn = (m) => warnings.push(m);
  try {
    validateSchema({ homeostasis_rate: 0.08,
      baselines: { mood: .5, energy: .5, curiosity: .5, affection: .5, focus: .5 },
      triggers: [{ condition: 'elapsed_days > 1', fire: 'long_absence' }] });
  } finally { console.warn = orig; process.env.ANIMUS_SILENT = '1'; }
  assert(warnings.some(w => /long_absence/.test(w)), 'no warning for dead trigger');
});

// ── Generated-persona path still works ────────────────────────────────────
section('Animus.create(seed)');

test('create(seed) builds, compiles, and absorbs an event', () => {
  const agent = Animus.create(42, { memoryPath: tmpState() });
  assert(agent.compile().length > 0, 'compile empty');
  const before = agent.state.mood;
  agent.apply('wonderful! [[delight:0.9]]');
  assert(agent.state.mood >= before, 'delight reduced mood');
});

// ── summary ───────────────────────────────────────────────────────────────
process.stdout.write(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) { process.stdout.write('README regression FAILED.\n'); process.exit(1); }
process.stdout.write('README quickstart verified.\n');
