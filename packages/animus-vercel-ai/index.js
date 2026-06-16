/**
 * @animus-sdk/vercel-ai
 * Vercel AI SDK middleware adapter for animus-sdk.
 *
 * Provides:
 *   createAnimusMiddleware   — wrapLanguageModel compatible middleware
 *   AnimusStreamTransform   — transforms streaming responses to apply events
 *   useAnimusChat           — React hook wrapper (returns useChat-compatible config)
 *
 * Usage:
 *   import { wrapLanguageModel } from 'ai';
 *   import { createAnimusMiddleware } from '@kahnark89/animus-vercel-ai';
 *
 *   const animus  = Animus.create(42);
 *   const model   = wrapLanguageModel({
 *     model: openai('gpt-4o'),
 *     middleware: createAnimusMiddleware(animus),
 *   });
 *
 * The middleware automatically:
 *   1. Calls animus.compile() before generation → injects mood into system prompt
 *   2. Calls animus.apply(text) after generation → updates state from response
 *
 * No changes to your existing prompts or chat loop required.
 *
 * @version 2.0.0
 */

'use strict';

const { Animus } = require('animus-sdk');

// ─── Core middleware ───────────────────────────────────────────────────────

/**
 * Creates a Vercel AI SDK-compatible middleware object.
 *
 * @param {Animus|number} animusOrSeed  Animus instance OR seed number (auto-creates)
 * @param {object}        [opts]
 * @param {string}        [opts.prefix]   Prefix for the mood injection (default: '[Affective state]')
 * @param {boolean}       [opts.autoGist] Auto-extract gist from user messages (default: true)
 * @returns {object}  Middleware with wrapGenerate and wrapStream
 */
function createAnimusMiddleware(animusOrSeed, opts = {}) {
  const animus = typeof animusOrSeed === 'number'
    ? Animus.create(animusOrSeed)
    : animusOrSeed;

  const prefix   = opts.prefix   ?? '[Affective state]';
  const autoGist = opts.autoGist ?? true;

  return {
    /**
     * Non-streaming generation wrapper.
     * Injects mood before, applies events after.
     */
    wrapGenerate: async ({ doGenerate, params }) => {
      const mood = animus.compile();

      // Inject into system prompt
      const system = params.system
        ? `${prefix} ${mood}\n\n${params.system}`
        : `${prefix} ${mood}`;

      // Auto-gist from human messages
      if (autoGist && Array.isArray(params.messages)) {
        for (const msg of params.messages) {
          if (msg.role === 'user') {
            const content = _extractText(msg.content);
            if (content) {
              const words = content.split(/\s+/).filter(w => w.length > 4).slice(0, 8);
              if (words.length) animus.gist(words.join(', '));
            }
          }
        }
      }

      const result = await doGenerate({ ...params, system });

      // Apply events from generated text
      if (result.text) animus.apply(result.text);

      return result;
    },

    /**
     * Streaming generation wrapper.
     * Injects mood before; accumulates streamed text and applies events after.
     */
    wrapStream: async ({ doStream, params }) => {
      const mood = animus.compile();

      const system = params.system
        ? `${prefix} ${mood}\n\n${params.system}`
        : `${prefix} ${mood}`;

      if (autoGist && Array.isArray(params.messages)) {
        for (const msg of params.messages) {
          if (msg.role === 'user') {
            const content = _extractText(msg.content);
            if (content) {
              const words = content.split(/\s+/).filter(w => w.length > 4).slice(0, 8);
              if (words.length) animus.gist(words.join(', '));
            }
          }
        }
      }

      const { stream, ...rest } = await doStream({ ...params, system });

      // Wrap the stream to accumulate text and apply events at end
      let accumulated = '';
      const wrappedStream = new TransformStream({
        transform(chunk, controller) {
          if (chunk.type === 'text-delta') accumulated += chunk.textDelta;
          controller.enqueue(chunk);
        },
        flush() {
          if (accumulated) animus.apply(accumulated);
        },
      });

      return {
        stream: stream.pipeThrough(wrappedStream),
        ...rest,
      };
    },
  };
}

// ─── useAnimusChat hook config factory ────────────────────────────────────

/**
 * Returns configuration object for Vercel AI's useChat hook.
 * Adds mood-line to the initial system message.
 *
 * Usage (Next.js app):
 *   const { messages, input, handleSubmit } = useChat({
 *     ...useAnimusChat(animus, { system: 'You are Aria...' }),
 *   });
 *
 * @param {Animus} animus
 * @param {object} [opts]
 * @param {string} [opts.system]  Your base system prompt
 * @returns {object}              Config object for useChat
 */
function useAnimusChat(animus, opts = {}) {
  return {
    initialMessages: [],
    body: {
      animus_mood: animus.compile(),
    },
    onResponse: (response) => {
      // Hook for server-side animus sync if needed
      opts.onResponse?.(response);
    },
    onFinish: (message) => {
      animus.apply(message.content || '');
      opts.onFinish?.(message);
    },
    system: opts.system
      ? `[Affective state] ${animus.compile()}\n\n${opts.system}`
      : undefined,
  };
}

// ─── AnimusStreamTransform ────────────────────────────────────────────────

/**
 * A Web Streams TransformStream that accumulates LLM output text
 * and applies events to an Animus instance at stream end.
 *
 * Use when you handle streaming manually (not via wrapLanguageModel).
 *
 * @param {Animus} animus
 * @returns {TransformStream}
 */
function AnimusStreamTransform(animus) {
  let accumulated = '';
  return new TransformStream({
    transform(chunk, controller) {
      if (typeof chunk === 'string') accumulated += chunk;
      else if (chunk?.text) accumulated += chunk.text;
      controller.enqueue(chunk);
    },
    flush() {
      if (accumulated) animus.apply(accumulated);
    },
  });
}

// ─── Route handler helper ─────────────────────────────────────────────────

/**
 * Next.js App Router / Edge Runtime helper.
 * Wraps your existing route handler to inject mood into every request.
 *
 * Usage (app/api/chat/route.ts):
 *   export const POST = withAnimus(animus, async (req, mood) => {
 *     const body = await req.json();
 *     // mood is already injected — just use it
 *     return streamText({ system: `${mood}\n\nYou are Aria.`, ... });
 *   });
 */
function withAnimus(animus, handler) {
  return async function (req) {
    const mood = animus.compile();
    return handler(req, mood);
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────

function _extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(p => p.type === 'text').map(p => p.text).join(' ');
  }
  return '';
}

module.exports = {
  createAnimusMiddleware,
  useAnimusChat,
  AnimusStreamTransform,
  withAnimus,
};
