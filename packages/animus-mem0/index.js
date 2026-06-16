/**
 * @animus-sdk/mem0
 * Mem0 memory bridge for animus-sdk.
 *
 * Mem0 remembers WHAT happened. Animus feels HOW it felt about it.
 * This adapter connects the two: episodic memories written to Mem0
 * are reflected in Animus's affective state, and Animus's emotional
 * trajectory is stored as searchable Mem0 memories.
 *
 * Architecture:
 *   Mem0 (vector store, semantic recall)
 *     ↕ AnimusMemoBridge
 *   Animus (affective physics, emotional continuity)
 *
 * Usage:
 *   import { AnimusMemoBridge } from '@kahnark89/animus-mem0';
 *   const bridge = new AnimusMemoBridge({ animus, mem0Client, userId: 'user_123' });
 *
 *   // After each exchange:
 *   await bridge.sync(userMessage, assistantResponse);
 *
 *   // Before each LLM call:
 *   const context = await bridge.context(); // { mood, relevantMemories }
 *
 * @version 2.0.0
 */

'use strict';

const { Animus } = require('animus-sdk');

// ─── AnimusMemoBridge ─────────────────────────────────────────────────────

class AnimusMemoBridge {
  /**
   * @param {object} opts
   * @param {Animus}   opts.animus      Animus instance
   * @param {object}   opts.mem0Client  Mem0 client (MemoryClient from 'mem0ai')
   * @param {string}   opts.userId      User/character ID for Mem0 namespacing
   * @param {object}   [opts.agentId]   Optional Mem0 agent ID
   * @param {number}   [opts.topK]      Number of relevant memories to surface (default: 5)
   */
  constructor(opts) {
    this.animus    = opts.animus;
    this.mem0      = opts.mem0Client;
    this.userId    = opts.userId;
    this.agentId   = opts.agentId;
    this.topK      = opts.topK ?? 5;
  }

  /**
   * Sync a completed exchange into both Mem0 and Animus.
   *
   * @param {string} userMessage       Raw user input
   * @param {string} assistantResponse Raw LLM response
   */
  async sync(userMessage, assistantResponse) {
    const messages = [
      { role: 'user',      content: userMessage },
      { role: 'assistant', content: assistantResponse },
    ];

    // Write to Mem0 (semantic factual memory)
    try {
      await this.mem0.add(messages, {
        user_id: this.userId,
        agent_id: this.agentId,
        metadata: {
          animus_mood_snapshot: this.animus.state,
          timestamp: Date.now(),
        },
      });
    } catch (err) {
      // Mem0 write failure should not break affective state
      console.warn('[animus-mem0] Mem0 write failed:', err.message);
    }

    // Update Animus (affective dynamics)
    this.animus.apply(assistantResponse);

    // Gist user topics into Animus memory
    const userWords = userMessage.split(/\s+/).filter(w => w.length > 4).slice(0, 8);
    if (userWords.length) this.animus.gist(userWords.join(', '));

    // Store emotionally significant moments as Animus episodic memory
    const events = this.animus.parseEvents(assistantResponse);
    if (events.length > 0) {
      const summary = `Exchange: user said "${userMessage.slice(0, 80)}" → events: ${events.map(e => e.type).join(', ')}`;
      const salience = Math.min(1, events.reduce((sum, e) => sum + (e.intensity || 1), 0) / 3);
      this.animus.remember(summary, salience);
    }
  }

  /**
   * Build context for the next LLM call.
   * Returns mood-line from Animus + relevant memories from Mem0.
   *
   * @param {string} [query]  Current user message (for Mem0 semantic search)
   * @returns {{ mood: string, memories: string[], systemPrefix: string }}
   */
  async context(query = '') {
    const mood = this.animus.compile();

    let mem0Memories = [];
    if (query) {
      try {
        const results = await this.mem0.search(query, {
          user_id: this.userId,
          agent_id: this.agentId,
          limit: this.topK,
        });
        mem0Memories = (results || []).map(r => r.memory || r.text || '').filter(Boolean);
      } catch (err) {
        console.warn('[animus-mem0] Mem0 search failed:', err.message);
      }
    }

    // Also surface Animus's own episodic memory
    const animusMemories = this.animus.topMemories(3);

    const allMemories = [...new Set([...animusMemories, ...mem0Memories])].slice(0, this.topK);

    const systemPrefix = [
      `[Affective state] ${mood}`,
      allMemories.length > 0
        ? `[Relevant context]\n${allMemories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n\n');

    return { mood, memories: allMemories, systemPrefix };
  }

  /**
   * Export Animus state to Mem0 for cross-session portability.
   * Stores the full Animus db snapshot as a Mem0 memory.
   */
  async exportStateToMem0() {
    const snapshot = this.animus.export();
    await this.mem0.add(
      [{ role: 'system', content: `[animus_state_snapshot] ${JSON.stringify(snapshot)}` }],
      { user_id: this.userId, agent_id: this.agentId }
    );
  }

  /**
   * Import Animus state from Mem0 (restore from previous session).
   */
  async importStateFromMem0() {
    const results = await this.mem0.search('[animus_state_snapshot]', {
      user_id: this.userId,
      agent_id: this.agentId,
      limit: 1,
    });
    if (results?.[0]?.memory) {
      try {
        const raw = results[0].memory.replace('[animus_state_snapshot] ', '');
        const snapshot = JSON.parse(raw);
        this.animus.import(snapshot);
      } catch (err) {
        console.warn('[animus-mem0] State import failed:', err.message);
      }
    }
  }
}

// ─── Standalone helpers ───────────────────────────────────────────────────

/**
 * Build a combined system prompt from Animus mood + Mem0 search results.
 * Standalone function for use without the full bridge class.
 *
 * @param {Animus}   animus
 * @param {object}   mem0Client
 * @param {string}   userId
 * @param {string}   query
 * @param {string}   [baseSystem]
 */
async function animusMem0System(animus, mem0Client, userId, query, baseSystem = '') {
  const mood = animus.compile();
  let memories = [];
  try {
    const results = await mem0Client.search(query, { user_id: userId, limit: 5 });
    memories = (results || []).map(r => r.memory || '').filter(Boolean);
  } catch { /* graceful degradation */ }

  const parts = [`[Affective state] ${mood}`];
  if (memories.length) parts.push(`[Memory context]\n${memories.join('\n')}`);
  if (baseSystem) parts.push(baseSystem);
  return parts.join('\n\n');
}

module.exports = {
  AnimusMemoBridge,
  animusMem0System,
};
