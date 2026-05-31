#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const cmd = process.argv[2];
const cwd = process.cwd();
const templatesDir = path.join(__dirname, '..', 'templates');

function init() {
  const targetDir = path.join(cwd, 'animus');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

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

  console.log('');
  console.log('Next steps:');
  console.log('  1. Edit animus/agent.schema.json — define your agent state variables');
  console.log('  2. npm install animus-sdk');
  console.log('  3. import { Animus } from \'animus-sdk\' and call agent.compile() before each LLM call');
}

function simulate() {
  console.log('Animus simulator: open animus-sdk/simulator/index.html in a browser,');
  console.log('or run the React dev server from the animus-sdk repo.');
  console.log('See https://github.com/kahnark89/animus-sdk for the simulator source.');
}

function status() {
  const schemaPath = path.join(cwd, 'animus', 'agent.schema.json');
  const memPath = path.join(cwd, 'animus', 'agent.memory.db');
  if (!fs.existsSync(schemaPath)) {
    console.log('No animus/agent.schema.json found. Run: animus init');
    process.exit(1);
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  console.log(`Agent: ${schema.name || '(unnamed)'}`);
  console.log(`Variables: ${(schema.variables || []).join(', ')}`);
  console.log(`Memory DB: ${fs.existsSync(memPath) ? 'present' : 'not yet created (will be on first run)'}`);
}

if (cmd === 'init')         init();
else if (cmd === 'simulate') simulate();
else if (cmd === 'status')   status();
else {
  console.log('animus-sdk CLI');
  console.log('');
  console.log('Usage:');
  console.log('  animus init        scaffold animus/ in current project');
  console.log('  animus simulate    open the state engine simulator');
  console.log('  animus status      show current agent schema and memory state');
}
