'use strict';
const engine = require('../src/engine');
const { generatePersona } = require('../src/persona');

const TURNS  = parseInt(process.argv[2] || '100', 10);
const SEEDS  = parseInt(process.argv[3] || '10',  10);
const EVENTS = ['delight','fatigue','discovery','conflict','play','boredom','distress','praise'];

function runAnimusConversation(seed, turns) {
  const schema = generatePersona(seed);
  let state = {}, vel = {}, noise = {};
  for (const v of engine.VARS) { state[v] = schema.baselines[v]; vel[v] = 0; noise[v] = 0; }
  const moodLines = [];
  let prevState = null;
  for (let t = 0; t < turns; t++) {
    const result = engine.runSteps(state, vel, noise, schema, Date.now() + t * 60000, 1, null);
    state = result.state; vel = result.velocityState; noise = result.noiseState;
    if (t % 10 === 0) {
      const evType = EVENTS[Math.floor(Math.random() * EVENTS.length)];
      const kicks  = engine.eventsToKicks([{ type: evType, intensity: 1 }], schema);
      const r2     = engine.runSteps(state, vel, noise, schema, Date.now() + t * 60000, 1, kicks);
      state = r2.state; vel = r2.velocityState; noise = r2.noiseState;
    }
    const line = engine.compile(state, schema, Date.now() + t * 60000, prevState, []);
    prevState = Object.assign({}, state);
    moodLines.push({ line, hash: engine.stateHash(state), t });
  }
  return moodLines;
}

function runStaticConversation(seed, turns) {
  const schema = generatePersona(seed);
  const state = Object.assign({}, schema.baselines);
  const moodLines = [];
  for (let t = 0; t < turns; t++) {
    const line = engine.compile(state, schema, Date.now(), null, []);
    moodLines.push({ line, hash: engine.stateHash(state), t });
  }
  return moodLines;
}

function uniquePhraseCount(turns) { return new Set(turns.map(t => t.line)).size; }
function semanticDrift(turns) {
  let total = 0;
  for (let i = 1; i < turns.length; i++) total += Math.abs(turns[i].hash - turns[i-1].hash);
  return total / (turns.length - 1);
}
function arcCoherence(turns) {
  const hashes = turns.map(t => t.hash);
  const mean = hashes.reduce((s,h)=>s+h,0)/hashes.length;
  const variance = hashes.reduce((s,h)=>s+(h-mean)**2,0)/hashes.length;
  return 1/(1+(variance/(mean||1))*10);
}
function benchmarkPhysics(n, steps) {
  const start = Date.now();
  for (let i = 0; i < n; i++) {
    const schema = generatePersona(i*7919+1);
    let state={},vel={},noise={};
    for (const v of engine.VARS){state[v]=schema.baselines[v];vel[v]=0;noise[v]=0;}
    engine.runSteps(state,vel,noise,schema,Date.now(),steps,null);
  }
  const ms = Date.now()-start;
  return {n,steps,totalSteps:n*steps,ms,stepsPerSec:Math.round(n*steps/(ms/1000))};
}

const avg = arr => arr.reduce((s,x)=>s+x,0)/arr.length;
const W = s => String(s).padStart(10);
const F = n => typeof n==='number'?n.toFixed(4):n;

console.log('\n  animus-sdk Benchmark Suite');
console.log('  '+'─'.repeat(60));
console.log('  Turns: '+TURNS+'   Seeds: '+SEEDS+'\n');

const aM={u:[],d:[],c:[]}, sM={u:[],d:[],c:[]};
for (let s=0;s<SEEDS;s++) {
  const seed = s*1000+42;
  const aT = runAnimusConversation(seed, TURNS);
  const sT = runStaticConversation(seed, TURNS);
  aM.u.push(uniquePhraseCount(aT)); aM.d.push(semanticDrift(aT)); aM.c.push(arcCoherence(aT));
  sM.u.push(uniquePhraseCount(sT)); sM.d.push(semanticDrift(sT)); sM.c.push(arcCoherence(sT));
}

console.log('  ── Emotional Arc Quality ('+TURNS+' turns x '+SEEDS+' seeds) ──\n');
console.log('  '+'Metric'.padEnd(30)+W('animus')+W('static')+'  Winner');
console.log('  '+'─'.repeat(58));
const rows=[
  {name:'Unique phrase variants',  a:avg(aM.u), s:avg(sM.u), hi:true},
  {name:'Semantic drift per turn', a:avg(aM.d), s:avg(sM.d), hi:true},
  {name:'Arc coherence',           a:avg(aM.c), s:avg(sM.c), hi:true},
];
for (const r of rows) {
  const aWins = r.a > r.s;
  console.log('  '+r.name.padEnd(30)+W(F(r.a))+W(F(r.s))+'  '+(aWins?'✓ animus':'  static'));
}

console.log('\n  ── Physics Throughput ──\n');
console.log('  '+'Config'.padEnd(28)+W('time(ms)')+W('steps/sec'));
console.log('  '+'─'.repeat(50));
for (const cfg of [{n:100,steps:240},{n:1000,steps:60},{n:10000,steps:1}]) {
  const r = benchmarkPhysics(cfg.n, cfg.steps);
  console.log('  '+(cfg.n+' seeds x '+cfg.steps+' steps').padEnd(28)+W(r.ms)+W(r.stepsPerSec.toLocaleString()));
}

console.log('\n  ── Persona Diversity (100 seeds) ──\n');
const traitVals={valence:[],arousal:[],stability:[],sociability:[],drive:[]};
const regs={};
for (let i=0;i<100;i++) {
  const sc=generatePersona(i*31337+42);
  for(const k of Object.keys(traitVals)) traitVals[k].push(sc._traits[k]);
  regs[sc.compiler.register]=(regs[sc.compiler.register]||0)+1;
}
console.log('  Trait distributions (mean ± std):');
for (const [trait,vals] of Object.entries(traitVals)) {
  const m=avg(vals);
  const std=Math.sqrt(vals.reduce((s,v)=>s+(v-m)**2,0)/vals.length);
  console.log('    '+trait.padEnd(14)+m.toFixed(3)+' ± '+std.toFixed(3));
}
console.log('\n  Voice register distribution:');
for (const [reg,count] of Object.entries(regs)) {
  console.log('    '+reg.padEnd(16)+'█'.repeat(Math.round(count/3)).padEnd(12)+count+'/100');
}
console.log('\n  npm install animus-sdk\n');
