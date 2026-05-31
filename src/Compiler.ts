'use strict';

import { AgentSchema, AgentState } from './StateEngine';

export class Compiler {
  private schema: AgentSchema;

  constructor(schema: AgentSchema) {
    this.schema = schema;
  }

  /**
   * Compile the current state into a single mood-line paragraph.
   * This is the ONLY interface the LLM should receive — never raw state values.
   */
  compile(state: AgentState, nowMs?: number): string {
    const bands = this.schema.compiler?.bands ?? {};
    const vars = this.schema.variables;

    const labeled: string[] = [];
    for (const v of vars) {
      const val = state.values[v] ?? 0.5;
      const vBands = bands[v];
      if (vBands) {
        labeled.push(this.band(val, vBands));
      }
    }

    if (labeled.length === 0) {
      return vars.map((v) => `${v}: ${(state.values[v] ?? 0.5).toFixed(2)}`).join('; ');
    }

    return this.buildParagraph(labeled, nowMs);
  }

  private band(value: number, labels: { low: string; mid: string; high: string }): string {
    if (value < 0.35) return labels.low;
    if (value <= 0.65) return labels.mid;
    return labels.high;
  }

  private buildParagraph(labels: string[], nowMs?: number): string {
    const parts: string[] = [];

    if (labels.length === 1) {
      parts.push(cap(labels[0]) + '.');
    } else if (labels.length === 2) {
      parts.push(`${cap(labels[0])} and ${labels[1]}.`);
    } else {
      parts.push(`${cap(labels[0])} and ${labels[1]}.`);
      const rest = labels.slice(2);
      if (rest.length === 1) {
        parts.push(cap(rest[0]) + '.');
      } else {
        const head = cap(rest[0]);
        const mid = rest.slice(1, -1).join(', ');
        const tail = rest[rest.length - 1];
        parts.push(mid ? `${head}, ${mid}, and ${tail}.` : `${head} and ${tail}.`);
      }
    }

    if (this.schema.circadian) {
      parts.push(this.circadianSentence(nowMs));
    }

    return parts.join(' ');
  }

  private circadianSentence(nowMs?: number): string {
    const hour = new Date(nowMs ?? Date.now()).getHours();
    if (hour >= 5 && hour < 9)  return 'The morning is just starting.';
    if (hour >= 9 && hour < 12) return 'Morning energy is at its peak.';
    if (hour >= 12 && hour < 14) return 'Midday — focus comes naturally.';
    if (hour >= 14 && hour < 17) return "Afternoon's second wind.";
    if (hour >= 17 && hour < 21) return 'Evening is settling in.';
    return "It's late — winding down.";
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
