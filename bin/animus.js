#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const cmd = process.argv[2];
const cwd = process.cwd();
const root = path.join(__dirname, '..');
const templatesDir = path.join(root, 'templates');

function init() {
  const targetDir = path.join(cwd, 'animus');
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const schemaTarget = path.join(targetDir, 'agent.schema.json');
  if (fs.existsSync(schemaTarget)) {
    console.log('⚠  animus/agent.schema.json already exists — skipping (will not overwrite).');
  } else {
    fs.copyFileSync(path.join(templatesDir, 'agent.schema.json'), schemaTarget);
    console.log('✓  Created animus/agent.schema.json');
  }

  const agentsMd = path.join(cwd, 'AGENTS.md');
  const snippet = fs.readFileSync(path.join(templatesDir, 'AGENTS.md'), 'utf8');
  if (fs.existsSync(agentsMd)) {
    const existing = fs.readFileSync(agentsMd, 'utf8');
    if (!existing.includes('## Animus')) {
      fs.appendFileSync(agentsMd, '\n\n' + snippet);
      console.log('✓  Appended Animus section to AGENTS.md');
    } else {
      console.log('⚠  AGENTS.md already has an Animus section — skipping.');
    }
  } else {
    fs.writeFileSync(agentsMd, snippet);
    console.log('✓  Created AGENTS.md with Animus section');
  }

  console.log('\nNext steps:');
  console.log("  1. Edit animus/agent.schema.json — define your agent's state variables");
  console.log('  2. import { Animus } from \'animus-sdk\' and call agent.compile() before each LLM call');
  console.log('  3. animus simulate — watch the state engine run on your schema');
}

function loadSchema() {
  const p = path.join(cwd, 'animus', 'agent.schema.json');
  if (!fs.existsSync(p)) { console.log('No animus/agent.schema.json found. Run: animus init'); process.exit(1); }
  return { path: p, schema: JSON.parse(fs.readFileSync(p, 'utf8')) };
}

// Generates a single self-contained HTML file: the REAL engine.js (UMD) + your
// schema, inlined. No server, no deps — open the file, watch your agent live.
function simulate() {
  const { schema } = loadSchema();
  const engineSrc = fs.readFileSync(path.join(root, 'src', 'engine.js'), 'utf8');
  let html = fs.readFileSync(path.join(templatesDir, 'simulator.html'), 'utf8');
  html = html.replace('/*__ENGINE__*/', () => engineSrc)
             .replace('/*__SCHEMA__*/', () => JSON.stringify(schema));
  const out = path.join(cwd, 'animus', 'simulator.html');
  fs.writeFileSync(out, html);
  console.log('✓  Built ' + path.relative(cwd, out));
  console.log('   Open it in any browser — it runs the shipping engine on your schema.');
}

function status() {
  const { schema } = loadSchema();
  const memPath = path.join(cwd, 'animus', 'agent.memory.db');
  console.log(`Agent: ${schema.name || '(unnamed)'}`);
  console.log(`Variables: ${(schema.variables || []).join(', ')}`);
  console.log(`λ (homeostasis): ${schema.homeostasis_rate != null ? schema.homeostasis_rate : 0.08}`);
  if (fs.existsSync(memPath)) {
    try {
      const db = JSON.parse(fs.readFileSync(memPath, 'utf8'));
      console.log(`Memory DB: present — last tick ${new Date(db.lastTick).toLocaleString()}`);
      console.log('State: ' + (schema.variables || []).map(v =>
        `${v}=${(db.state[v] != null ? db.state[v] : 0).toFixed(2)}`).join('  '));
      console.log(`Episodic memories: ${(db.memories || []).length}  ·  events logged: ${(db.eventLog || []).length}`);
    } catch (e) { console.log('Memory DB: present but unreadable (' + e.message + ')'); }
  } else {
    console.log('Memory DB: not yet created (will be on first agent.apply / agent.compile with a memory path)');
  }
}

if (cmd === 'init') init();
else if (cmd === 'simulate') simulate();
else if (cmd === 'status') status();
else {
  console.log('animus-sdk CLI\n');
  console.log('Usage:');
  console.log('  animus init        scaffold animus/ in current project');
  console.log('  animus simulate    build animus/simulator.html — the live state engine on your schema');
  console.log('  animus status      show schema, λ, and persisted state');
}
