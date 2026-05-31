import path from 'path';
import { Animus } from 'animus-sdk';

const agent = new Animus({
  schema: path.join(__dirname, '..', 'animus', 'agent.schema.json'),
  memory: path.join(__dirname, '..', 'animus', 'agent.memory.json'),
});

// --- Compile mood-line (does NOT advance state) ---
console.log('Current mood-line:');
console.log(' ', agent.compile());
console.log();

// --- Apply an event (advances one tick) ---
agent.apply([{ type: 'delight', intensity: 0.8 }]);
console.log('After a delight event:');
console.log(' ', agent.compile());
console.log();

// --- Advance time without an event ---
for (let i = 0; i < 5; i++) agent.tick();
console.log('After 5 natural ticks:');
console.log(' ', agent.compile());
console.log();

// --- Persist state ---
agent.save();
console.log('State saved to animus/agent.memory.json');
console.log('Raw values:', agent.getState().values);
