#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const cmd = process.argv[2];
const cwd = process.cwd();
const templatesDir = path.join(__dirname, '..', 'templates');

function loadDist(module) {
  const p = path.join(__dirname, '..', 'dist', module + '.js');
  if (!fs.existsSync(p)) {
    console.error(`Error: dist/${module}.js not found. Run: npm run build`);
    process.exit(1);
  }
  return require(p);
}

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
  console.log("  3. import { Animus } from 'animus-sdk' and call agent.compile() before each LLM call");
}

function simulate() {
  const simDir = path.join(__dirname, '..', 'simulator');
  const htmlFile = path.join(simDir, 'index.html');

  if (!fs.existsSync(htmlFile)) {
    console.log('Animus simulator: simulator/index.html not found.');
    console.log('See: https://github.com/kahnark89/animus-sdk');
    return;
  }

  // Try platform-specific open commands
  const { spawnSync } = require('child_process');
  const openers = process.platform === 'win32' ? ['start'] : process.platform === 'darwin' ? ['open'] : ['xdg-open'];

  for (const opener of openers) {
    const result = spawnSync(opener, [htmlFile], { stdio: 'ignore' });
    if (result.status === 0) {
      console.log(`Animus simulator opened: ${htmlFile}`);
      return;
    }
  }

  // Fallback: minimal HTTP server
  const http = require('http');
  const port = 7474;
  const server = http.createServer((req, res) => {
    const schemaPath = path.join(cwd, 'animus', 'agent.schema.json');
    if (req.url === '/animus/agent.schema.json' && fs.existsSync(schemaPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(schemaPath));
      return;
    }
    const file = req.url === '/' || req.url === '/index.html' ? htmlFile : path.join(simDir, req.url);
    if (fs.existsSync(file) && !file.includes('..')) {
      const ext = path.extname(file);
      const ct = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'text/html';
      res.writeHead(200, { 'Content-Type': ct });
      res.end(fs.readFileSync(file));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  server.listen(port, () => {
    console.log(`Animus simulator running at http://localhost:${port}`);
    console.log('Press Ctrl+C to stop.');
  });
}

function status() {
  const schemaPath = path.join(cwd, 'animus', 'agent.schema.json');
  const memPath = path.join(cwd, 'animus', 'agent.memory.json');
  if (!fs.existsSync(schemaPath)) {
    console.log('No animus/agent.schema.json found. Run: animus init');
    process.exit(1);
  }

  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  console.log(`Agent: ${schema.name || '(unnamed)'}`);
  console.log(`Variables: ${(schema.variables || []).join(', ')}`);

  if (fs.existsSync(memPath)) {
    try {
      const { Animus } = loadDist('index');
      const agent = new Animus({ schema: schemaPath, memory: memPath });
      console.log(`Memory: present (tick ${agent.getState().tick})`);
      console.log(`\nCurrent mood-line:\n  ${agent.compile()}`);
    } catch (_) {
      console.log('Memory: present (rebuild dist to inspect state)');
    }
  } else {
    console.log('Memory: not yet created (will be on first run)');
  }
}

function inject() {
  // animus inject --from-cortex [--file <path>] [--dry-run]
  const args = process.argv.slice(3);
  const isDryRun  = args.includes('--dry-run');
  const fileIdx   = args.indexOf('--file');
  const filePath  = fileIdx >= 0 ? args[fileIdx + 1] : null;

  let bundleJson = '';

  if (filePath) {
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    bundleJson = fs.readFileSync(filePath, 'utf8');
    applyBundle(bundleJson, isDryRun);
  } else {
    // Read from stdin
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      bundleJson = Buffer.concat(chunks).toString('utf8');
      applyBundle(bundleJson, isDryRun);
    });
    process.stdin.on('error', () => {
      console.error('Error reading from stdin. Use --file <path> instead.');
      process.exit(1);
    });
  }
}

function applyBundle(bundleJson, isDryRun) {
  let bundle;
  try {
    bundle = JSON.parse(bundleJson);
  } catch (_) {
    console.error('Invalid JSON — is the output of `cortex context` piped correctly?');
    process.exit(1);
  }

  const schemaPath = path.join(cwd, 'animus', 'agent.schema.json');
  const memPath    = path.join(cwd, 'animus', 'agent.memory.json');

  if (!fs.existsSync(schemaPath)) {
    console.error('No animus/agent.schema.json found. Run: animus init');
    process.exit(1);
  }

  const { Animus }        = loadDist('index');
  const { cortexToEvents } = loadDist('adapters/cortex');

  const agent  = new Animus({ schema: schemaPath, memory: memPath });
  const events = cortexToEvents(bundle);

  if (events.length === 0) {
    console.log('Animus: no events generated from Cortex context.');
    return;
  }

  console.log(`Animus: applying ${events.length} event(s) from Cortex context:`);
  for (const e of events) {
    console.log(`  ${e.type.padEnd(12)} (${e.intensity.toFixed(2)})`);
  }

  if (isDryRun) {
    console.log('\n[dry-run] State not saved.');
    return;
  }

  agent.apply(events);
  agent.save();
  console.log('State saved to animus/agent.memory.json');
}

if      (cmd === 'init')                         init();
else if (cmd === 'simulate')                     simulate();
else if (cmd === 'status')                       status();
else if (cmd === 'inject' && process.argv[3] === '--from-cortex') inject();
else {
  console.log('animus-sdk CLI');
  console.log('');
  console.log('Usage:');
  console.log('  animus init                    scaffold animus/ in current project');
  console.log('  animus simulate                open the state engine simulator');
  console.log('  animus status                  show current agent schema and mood-line');
  console.log('  animus inject --from-cortex    read cortex context (stdin or --file) and apply events');
  console.log('    [--file <path>]              read from file instead of stdin');
  console.log('    [--dry-run]                  show events without saving');
}
