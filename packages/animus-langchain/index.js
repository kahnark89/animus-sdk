/**
 * @animus-sdk/langchain
 * LangChain / LangGraph adapter for animus-sdk.
 *
 * Provides:
 *   AnimusNode        — LangGraph StateGraph node (compile + apply in one step)
 *   AnimusRunnable    — RunnableLambda that injects mood into any chain
 *   animusSystemMsg   — SystemMessage factory with mood-line prepended
 *   AnimusMemoryBridge— Bridges animus memory to LangChain memory stores
 *
 * Usage (LangGraph):
 *   import { AnimusNode } from '@kahnark89/animus-langchain';
 *   const node = AnimusNode.create(42);
 *   graph.addNode('animus', node.asGraphNode());
 *
 * Usage (LCEL chain):
 *   import { AnimusRunnable } from '@kahnark89/animus-langchain';
 *   const chain = AnimusRunnable.from(animus) | chatModel | outputParser;
 *
 * @version 2.0.0
 */

'use strict';

const { Animus } = require('animus-sdk');

// ─── AnimusNode (LangGraph) ────────────────────────────────────────────────

class AnimusNode {
  constructor(animus) {
    this.animus = animus;
  }

  static create(seed, opts = {}) {
    return new AnimusNode(Animus.create(seed, opts));
  }

  /**
   * Returns a LangGraph-compatible async node function.
   * Adds { animus_mood, animus_state, animus_schema_id } to graph state.
   * Also auto-applies events from any 'messages' in the state.
   *
   * @example
   *   const builder = new StateGraph(StateAnnotation);
   *   builder.addNode('emotion', AnimusNode.create(42).asGraphNode());
   */
  asGraphNode() {
    const self = this;
    return async function animusGraphNode(state) {
      // Apply events from any assistant messages in graph state
      const messages = state.messages || [];
      for (const msg of messages) {
        if (msg._getType?.() === 'ai' || msg.role === 'assistant') {
          const content = typeof msg.content === 'string' ? msg.content : '';
          self.animus.apply(content);
        }
      }
      return self.animus.toLangChainState();
    };
  }

  /**
   * Returns a system prompt string with mood prepended.
   * Use in ChatPromptTemplate as the system message.
   */
  systemPrompt(base = '') {
    return this.animus.toSystemPrompt(base);
  }

  /** Access the underlying Animus instance for direct API calls. */
  get instance() { return this.animus; }
}

// ─── AnimusRunnable (LCEL) ────────────────────────────────────────────────

/**
 * RunnableLambda-compatible wrapper.
 * Injects the mood-line into the 'system' key of the input dict,
 * then passes through to the next runnable in the chain.
 *
 * Works with any LCEL chain that accepts { system, messages, ... }.
 */
class AnimusRunnable {
  constructor(animus) {
    this.animus = animus;
  }

  static from(animus) {
    return new AnimusRunnable(animus);
  }

  static create(seed, opts = {}) {
    return new AnimusRunnable(Animus.create(seed, opts));
  }

  /** Invoke: injects mood into input dict, returns updated dict. */
  async invoke(input) {
    const mood = this.animus.compile();
    const system = input.system
      ? `[Affective state] ${mood}\n\n${input.system}`
      : `[Affective state] ${mood}`;
    return { ...input, system };
  }

  /** Pipe operator for LCEL chaining (if LangChain's pipe is available). */
  pipe(next) {
    const self = this;
    return {
      invoke: async (input) => {
        const updated = await self.invoke(input);
        return next.invoke(updated);
      },
    };
  }
}

// ─── SystemMessage factory ────────────────────────────────────────────────

/**
 * Returns a LangChain SystemMessage (or plain object) with mood prepended.
 * Import SystemMessage from @langchain/core/messages if available.
 *
 * @param {Animus} animus
 * @param {string} [base]  Your existing system prompt
 */
function animusSystemMsg(animus, base = '') {
  const content = animus.toSystemPrompt(base);
  // Return a plain object that's structurally compatible with SystemMessage
  // without requiring @langchain/core as a hard dependency
  return { _getType: () => 'system', content, role: 'system' };
}

// ─── AnimusMemoryBridge ───────────────────────────────────────────────────

/**
 * Bridges LangChain conversation history into animus episodic memory.
 * Call after each chain invocation to keep animus memory in sync.
 *
 * @param {Animus}   animus
 * @param {object[]} messages  Array of LangChain message objects
 */
function syncAnimusMemory(animus, messages) {
  for (const msg of messages) {
    const type = msg._getType?.() || msg.role;
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (!content) continue;

    if (type === 'human' || type === 'user') {
      // Extract topics from human messages as gist
      const words = content.split(/\s+/).filter(w => w.length > 4).slice(0, 5);
      if (words.length) animus.gist(words.join(', '));
    }

    if (type === 'ai' || type === 'assistant') {
      // Auto-apply events from assistant responses
      animus.apply(content);
    }
  }
}

module.exports = {
  AnimusNode,
  AnimusRunnable,
  animusSystemMsg,
  syncAnimusMemory,
};
