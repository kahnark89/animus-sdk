/**
 * @animus-sdk/crewai
 * CrewAI adapter for animus-sdk.
 *
 * Provides:
 *   AnimusTool          — CrewAI BaseTool for agents to query/update their own affective state
 *   AnimusCrew          — Wrapper that adds per-agent Animus instances to a CrewAI crew
 *   crewEmotionalSync   — Apply inter-agent emotional contagion after each task
 *
 * Usage:
 *   from crewai import Agent, Task, Crew
 *   from animus_sdk.crewai import AnimusTool, AnimusCrew
 *
 *   researcher = Agent(role='Researcher', tools=[AnimusTool(seed=101)])
 *   writer     = Agent(role='Writer',     tools=[AnimusTool(seed=202)])
 *   crew = AnimusCrew(agents=[researcher, writer], coupling_strength=0.04)
 *
 * Note: This file exports both a JS module (for JS CrewAI) and
 * a Python bridge spec. The Python class stubs are in crewai.py.
 *
 * @version 2.0.0
 */

'use strict';

const { Animus } = require('animus-sdk');
const engine = require('animus-sdk/src/engine');

// ─── AnimusTool ───────────────────────────────────────────────────────────

/**
 * CrewAI-compatible tool that gives an agent awareness of its own affective state.
 *
 * The agent can:
 *   - Query its current mood ("how am I feeling?")
 *   - Apply events based on task outcomes ("this task was frustrating")
 *   - Surface its state for the crew manager
 */
class AnimusTool {
  constructor(animusOrSeed, opts = {}) {
    this.animus = typeof animusOrSeed === 'number'
      ? Animus.create(animusOrSeed)
      : animusOrSeed;
    this.name        = opts.name        || 'affective_state';
    this.description = opts.description || 'Query or update your current emotional/affective state. Use before tasks that depend on your current energy, focus, or mood. Input: JSON with action ("compile"|"apply"|"diagnose") and optional events array.';
  }

  /**
   * Tool invocation — called by CrewAI when the agent uses the tool.
   * @param {string|object} input  JSON string or object with { action, events?, text? }
   */
  async run(input) {
    let parsed;
    try {
      parsed = typeof input === 'string' ? JSON.parse(input) : input;
    } catch {
      parsed = { action: 'compile' };
    }

    switch (parsed.action) {
      case 'compile':
        return { mood: this.animus.compile(), state: this.animus.state };

      case 'apply': {
        const events = parsed.events || (parsed.text ? null : []);
        const text   = parsed.text || '';
        if (text) this.animus.apply(text);
        else if (events && events.length) this.animus.apply(events);
        return { applied: true, state: this.animus.state };
      }

      case 'diagnose':
        return this.animus.diagnose();

      case 'remember':
        this.animus.remember(parsed.text || '', parsed.salience || 0.5);
        return { remembered: true };

      default:
        return { error: `Unknown action: ${parsed.action}. Use "compile", "apply", "diagnose", or "remember".` };
    }
  }

  /** Access underlying Animus for crew-level operations. */
  get instance() { return this.animus; }
}

// ─── AnimusCrew ───────────────────────────────────────────────────────────

/**
 * Wraps a set of { agent, animus } pairs into a crew with emotional contagion.
 * After each task, emotional state propagates between agents based on coupling strength.
 *
 * @param {Array<{ agent: object, animus: Animus }>} members
 * @param {number} [couplingStrength=0.04]  Social influence strength between agents
 */
class AnimusCrew {
  constructor(members, couplingStrength = 0.04) {
    this.members = members;
    this.strength = couplingStrength;

    // Wire up bidirectional coupling between all members
    for (const m of members) {
      for (const other of members) {
        if (m !== other) m.animus.couple(other.animus, couplingStrength);
      }
    }
  }

  /**
   * Called after each task completion.
   * Applies emotional contagion: each agent's state influences others.
   *
   * @param {string} [taskOutput]  Output text from the completed task (for event inference)
   * @param {object} [executor]    The agent that executed the task
   */
  async afterTask(taskOutput = '', executor = null) {
    for (const m of this.members) {
      const peers = this.members
        .filter(p => p !== m)
        .map(p => ({ state: p.animus.state, schema: p.animus.schema, strength: this.strength }));

      if (peers.length > 0) {
        const socialKicks = engine.socialInfluenceKicks(m.animus.schema, peers);
        m.animus.apply(Object.entries(socialKicks)
          .filter(([, v]) => Math.abs(v) > 0.01)
          .map(([type, mag]) => ({ type: mag > 0 ? 'delight' : 'distress', intensity: Math.abs(mag) * 2 }))
        );
      }

      if (taskOutput && m.animus === executor?.animus) {
        m.animus.apply(taskOutput);
      }
    }
  }

  /** Get mood summary for all crew members (for manager LLM context). */
  crewMoodSummary() {
    return this.members.map(m => ({
      agent: m.agent?.role || m.role || 'agent',
      mood: m.animus.compile(),
      state: m.animus.state,
    }));
  }

  /** Highest-energy agent — good choice for demanding tasks. */
  mostEnergized() {
    return this.members.slice().sort((a, b) => b.animus.state.energy - a.animus.state.energy)[0];
  }

  /** Most focused agent — good choice for precision tasks. */
  mostFocused() {
    return this.members.slice().sort((a, b) => b.animus.state.focus - a.animus.state.focus)[0];
  }
}

// ─── Crew-level helpers ───────────────────────────────────────────────────

/**
 * Apply emotional contagion across a flat array of Animus instances.
 * Standalone — doesn't require AnimusCrew.
 *
 * @param {Animus[]} instances
 * @param {number}   strength
 */
function crewEmotionalSync(instances, strength = 0.04) {
  for (const inst of instances) {
    const peers = instances
      .filter(p => p !== inst)
      .map(p => ({ state: p.state, schema: p.schema, strength }));
    if (peers.length) {
      const kicks = engine.socialInfluenceKicks(inst.schema, peers);
      const evArr = Object.entries(kicks)
        .filter(([, v]) => Math.abs(v) > 0.01)
        .map(([, mag]) => ({ type: mag > 0 ? 'delight' : 'distress', intensity: Math.abs(mag) }));
      if (evArr.length) inst.apply(evArr);
    }
  }
}

module.exports = {
  AnimusTool,
  AnimusCrew,
  crewEmotionalSync,
};
