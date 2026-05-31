// Animus Simulator — self-contained state engine (no bundler, no CDN)
// Mirrors the logic in src/StateEngine.ts and src/Compiler.ts exactly.

// ── State Engine ─────────────────────────────────────────────────────────────

function clamp01(v) { return Math.min(1, Math.max(0, v)); }

function computeEffectiveBaseline(schema, variable, nowMs) {
  const baseline = schema.baselines[variable] ?? 0.5;
  if (!schema.circadian || variable !== 'energy') return baseline;
  const now = new Date(nowMs ?? Date.now());
  const hour = now.getHours() + now.getMinutes() / 60;
  const peakHours = (schema.circadian.peaks ?? []).map(p => {
    const [h, m] = p.split(':').map(Number);
    return h + m / 60;
  });
  const circFactor = peakHours.length > 0
    ? Math.max(...peakHours.map(pk => (Math.cos((hour - pk) * 2 * Math.PI / 24) + 1) / 2))
    : 1.0;
  const floor = schema.circadian.floor ?? 0.0;
  return floor + (baseline - floor) * circFactor;
}

function computeCoupling(schema, variable, state) {
  const couplings = schema.coupling?.[variable];
  if (!couplings) return 0;
  let total = 0;
  for (const [src, kappa] of Object.entries(couplings)) {
    const srcVal = state.values[src] ?? schema.baselines[src] ?? 0.5;
    const srcBase = schema.baselines[src] ?? 0.5;
    total += kappa * (srcVal - srcBase);
  }
  return total;
}

function advanceNoise(schema, current) {
  const mag   = schema.noise?.magnitude ?? 0;
  const alpha = schema.noise?.autocorrelation ?? 0;
  const delta = (Math.random() * 2 - 1) * mag;
  return alpha * current + (1 - alpha) * delta;
}

function tickState(schema, state, kicks = {}) {
  const newValues = {};
  const newNoise  = {};
  const nowMs = Date.now();
  for (const v of schema.variables) {
    const x  = state.values[v] ?? schema.baselines[v] ?? 0.5;
    const x0 = computeEffectiveBaseline(schema, v, nowMs);
    const lam = schema.homeostasis_rate;
    const coupling = computeCoupling(schema, v, state);
    const kick = kicks[v] ?? 0;
    const prev = state.noise[v] ?? 0;
    const noise = advanceNoise(schema, prev);
    newNoise[v]  = noise;
    newValues[v] = clamp01(x + lam * (x0 - x) + coupling + kick + noise);
  }
  return { values: newValues, noise: newNoise, tick: state.tick + 1, timestamp: nowMs };
}

function initialState(schema) {
  const values = {};
  const noise  = {};
  for (const v of schema.variables) {
    values[v] = schema.baselines[v] ?? 0.5;
    noise[v]  = 0;
  }
  return { values, noise, tick: 0, timestamp: Date.now() };
}

// ── Compiler ──────────────────────────────────────────────────────────────────

function bandLabel(value, labels) {
  if (value < 0.35) return labels.low;
  if (value <= 0.65) return labels.mid;
  return labels.high;
}

function compileMoodLine(schema, state) {
  const bands = schema.compiler?.bands ?? {};
  const labeled = [];
  for (const v of schema.variables) {
    const val = state.values[v] ?? 0.5;
    if (bands[v]) labeled.push(bandLabel(val, bands[v]));
  }
  if (labeled.length === 0) {
    return schema.variables.map(v => `${v}: ${(state.values[v] ?? 0.5).toFixed(2)}`).join('; ');
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  if (labeled.length === 1) return cap(labeled[0]) + '.';
  if (labeled.length === 2) return `${cap(labeled[0])} and ${labeled[1]}.`;
  const first = `${cap(labeled[0])} and ${labeled[1]}.`;
  const rest = labeled.slice(2);
  const head = cap(rest[0]);
  const mid  = rest.slice(1, -1).join(', ');
  const tail = rest[rest.length - 1];
  const second = mid ? `${head}, ${mid}, and ${tail}.` : rest.length === 1 ? cap(rest[0]) + '.' : `${head} and ${tail}.`;
  return first + ' ' + second;
}

// ── Built-in Events ───────────────────────────────────────────────────────────

const BUILTIN_EVENTS = {
  delight:     { mood:  0.25, energy:  0.15 },
  confusion:   { curiosity: -0.20, mood: -0.08 },
  reunion:     { affection: 0.30, mood:  0.20, energy: 0.15 },
  fatigue:     { energy: -0.25, focus: -0.15, mood: -0.08 },
  frustration: { mood: -0.20, focus: -0.15, energy: -0.10 },
  relief:      { mood:  0.20, energy:  0.10 },
  surprise:    { curiosity: 0.25, energy:  0.15 },
  boredom:     { curiosity: -0.20, focus: -0.15, energy: -0.10 },
};

function fireEvent(schema, state, eventName, intensity = 1.0) {
  const template = { ...BUILTIN_EVENTS, ...(schema.events ?? {}) }[eventName];
  if (!template) return state;
  const kicks = {};
  for (const [v, mag] of Object.entries(template)) {
    kicks[v] = (kicks[v] ?? 0) + mag * intensity;
  }
  return tickState(schema, state, kicks);
}

// ── Canvas Renderer ───────────────────────────────────────────────────────────

const COLORS = ['#4f8ef7', '#f7874f', '#4ff78a', '#f74f7a', '#c74ff7', '#f7e44f', '#4ff7e4'];
const HISTORY_LEN = 120;

class SimulatorApp {
  constructor(canvas, moodlineEl, schema) {
    this.canvas     = canvas;
    this.ctx        = canvas.getContext('2d');
    this.moodlineEl = moodlineEl;
    this.schema     = schema;
    this.state      = initialState(schema);
    this.history    = schema.variables.map(() => []);
    this.interval   = null;
    this.speed      = 200; // ms per tick
  }

  start() {
    this.interval = setInterval(() => this.step(), this.speed);
  }

  stop() { clearInterval(this.interval); }

  setSpeed(ms) {
    this.stop();
    this.speed = ms;
    this.start();
  }

  step(kicks = {}) {
    this.state = tickState(this.schema, this.state, kicks);
    this.schema.variables.forEach((v, i) => {
      this.history[i].push(this.state.values[v]);
      if (this.history[i].length > HISTORY_LEN) this.history[i].shift();
    });
    this.render();
  }

  fireEvent(name, intensity = 1.0) {
    this.state = fireEvent(this.schema, this.state, name, intensity);
    this.render();
  }

  render() {
    const { canvas, ctx, schema, state, history } = this;
    const W = canvas.width;
    const H = canvas.height;
    const pad = { top: 30, bottom: 30, left: 40, right: 20 };
    const chartH = H - pad.top - pad.bottom;
    const chartW = W - pad.left - pad.right;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    // Grid lines at 0.25, 0.50, 0.75, 1.0
    ctx.strokeStyle = '#2a2a4e';
    ctx.lineWidth = 1;
    for (const level of [0.25, 0.50, 0.75, 1.0]) {
      const y = pad.top + chartH * (1 - level);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + chartW, y);
      ctx.stroke();
      ctx.fillStyle = '#4a4a7e';
      ctx.font = '10px monospace';
      ctx.fillText(level.toFixed(2), 2, y + 4);
    }

    // Variable time-series
    for (let i = 0; i < schema.variables.length; i++) {
      const hist = history[i];
      if (hist.length < 2) continue;
      ctx.strokeStyle = COLORS[i % COLORS.length];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let j = 0; j < hist.length; j++) {
        const x = pad.left + (j / (HISTORY_LEN - 1)) * chartW;
        const y = pad.top + chartH * (1 - hist[j]);
        j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Current value dot
      const lastX = pad.left + ((hist.length - 1) / (HISTORY_LEN - 1)) * chartW;
      const lastY = pad.top + chartH * (1 - hist[hist.length - 1]);
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();
    }

    // Legend
    ctx.font = '11px monospace';
    schema.variables.forEach((v, i) => {
      const val = state.values[v] ?? 0;
      const x = pad.left + (i * 85) % chartW;
      const y = H - 8;
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fillRect(x, y - 9, 10, 10);
      ctx.fillStyle = '#ccc';
      ctx.fillText(`${v} ${val.toFixed(2)}`, x + 13, y);
    });

    // Tick counter
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.fillText(`tick ${state.tick}`, W - 65, H - 8);

    // Mood-line
    this.moodlineEl.textContent = compileMoodLine(this.schema, state);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

let app;

async function loadSchema() {
  try {
    const res = await fetch('/animus/agent.schema.json');
    if (res.ok) return await res.json();
  } catch (_) {}

  // Fallback: built-in template schema
  return {
    name: 'demo-agent',
    variables: ['mood', 'energy', 'curiosity', 'affection', 'focus'],
    baselines: { mood: 0.65, energy: 0.70, curiosity: 0.75, affection: 0.50, focus: 0.60 },
    homeostasis_rate: 0.08,
    coupling: { energy: { mood: 0.30, curiosity: 0.25, focus: 0.20 } },
    circadian: { peaks: ['09:00', '14:00'], floor: 0.15 },
    noise: { magnitude: 0.02, autocorrelation: 0.70 },
    compiler: {
      bands: {
        mood:      { low: 'a bit flat',        mid: 'steady',       high: 'bright and joyful' },
        energy:    { low: 'low-energy, quiet', mid: 'focused',      high: 'bouncy and energised' },
        curiosity: { low: 'mellow',            mid: 'interested',   high: 'fascinated, full of questions' },
        affection: { low: 'warm',              mid: 'fond',         high: 'genuinely devoted' },
        focus:     { low: 'scattered',         mid: 'on task',      high: 'deeply absorbed' },
      },
    },
  };
}

window.addEventListener('DOMContentLoaded', async () => {
  const canvas     = document.getElementById('canvas');
  const moodlineEl = document.getElementById('moodline');
  const speedSlider = document.getElementById('speed');
  const speedLabel  = document.getElementById('speed-label');
  const btnContainer = document.getElementById('events');

  const schema = await loadSchema();
  document.getElementById('agent-name').textContent = schema.name;

  app = new SimulatorApp(canvas, moodlineEl, schema);
  app.start();

  // Speed slider
  speedSlider.addEventListener('input', () => {
    const ms = parseInt(speedSlider.value, 10);
    speedLabel.textContent = `${ms}ms`;
    app.setSpeed(ms);
  });

  // Event buttons — built-ins + schema-defined
  const allEvents = { ...BUILTIN_EVENTS, ...(schema.events ?? {}) };
  for (const name of Object.keys(allEvents)) {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.onclick = () => app.fireEvent(name, 1.0);
    btnContainer.appendChild(btn);
  }
});
