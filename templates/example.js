/**
 * Minimal runnable Animus example.
 *
 *   node animus/example.js
 *
 * State persists to .animus/<id>.json — the same place `npx animus status` reads.
 * Run it a few times: the affective state carries over and drifts between runs.
 */

const path = require('path');
const { Animus } = require('animus-sdk');

const agent = new Animus({
  schema: path.join(__dirname, 'agent.schema.json'),
  // no memoryPath → defaults to .animus/<id>.json
  // for a server-side companion, pass a per-user store instead:
  //   store: myRedisStore   (and use `await Animus.open({ store, schema })`)
});

// 1. Before your LLM call — compile the live state into a mood-line and prepend it
//    to your system prompt.
const moodLine = agent.compile();
console.log('mood-line →', moodLine);

// 2. Your LLM call happens here. Tell the model (in its system prompt) to annotate
//    emotionally significant moments with [[event]] or [[event:intensity]] tags.
//    Here we simulate a reply:
const reply = 'So glad to see you again — wonderful! [[reunion:0.8]] [[delight:0.5]]';

// 3. After the call — absorb the events, then show the cleaned text to the user.
agent.apply(reply);
console.log('clean reply →', agent.cleanText(reply));
console.log('state →', agent.state);

// 4. Persist. (Write-behind also flushes automatically on normal process exit;
//    flush() lets you await durability explicitly.)
agent.flush().then(() => console.log('state saved.'));
