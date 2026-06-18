#!/usr/bin/env node
/**
 * scripts/build-playground.js
 *
 * Builds the interactive playground from playground/playground.template.html by
 * inlining the PRODUCTION src/engine.js and src/persona.js (same pattern the CLI
 * uses for the simulator). There is exactly one engine implementation in the repo
 * — src/engine.js — and the playground now runs it verbatim. The template's UI is
 * untouched; a thin shim maps the UI's call-shapes onto the real engine API.
 *
 * Outputs:
 *   playground/index.html   canonical demo (committed; `npm run playground` serves it)
 *   docs/index.html         GitHub Pages deploy copy (identical build artifact)
 *
 * Both are GENERATED. Edit playground/playground.template.html, then:
 *   npm run build:playground
 *
 * Zero dependencies.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const R = (...p) => path.join(ROOT, ...p);

const TEMPLATE = R('playground', 'playground.template.html');
const OUTPUTS  = [R('playground', 'index.html'), R('docs', 'index.html')];

function build() {
  const engineSrc  = fs.readFileSync(R('src', 'engine.js'), 'utf8');
  const personaSrc = fs.readFileSync(R('src', 'persona.js'), 'utf8');
  let html = fs.readFileSync(TEMPLATE, 'utf8');

  if (!html.includes('/*__ENGINE__*/'))  throw new Error('template missing /*__ENGINE__*/ placeholder');
  if (!html.includes('/*__PERSONA__*/')) throw new Error('template missing /*__PERSONA__*/ placeholder');

  // Use function replacers so `$` sequences in source are never treated as
  // replacement patterns.
  html = html.replace('/*__ENGINE__*/',  () => engineSrc)
             .replace('/*__PERSONA__*/', () => personaSrc);

  for (const out of OUTPUTS) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
    process.stdout.write(`\u2713  Built ${path.relative(ROOT, out)}  (${(html.length / 1024).toFixed(0)} KB)\n`);
  }
  process.stdout.write('   Runs the production src/engine.js — same engine as Node.\n');
}

build();
