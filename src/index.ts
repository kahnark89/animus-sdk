'use strict';

import fs from 'fs';
import { AgentSchema, AgentState, StateEngine } from './StateEngine';
import { AnimusEvent, EventSystem } from './EventSystem';
import { Compiler } from './Compiler';
import { Memory, MemoryFile } from './Memory';

export interface AnimusConfig {
  schema: string | AgentSchema;
  memory?: string;
}

export class Animus {
  private schema: AgentSchema;
  private state: AgentState;
  private engine: StateEngine;
  private compiler: Compiler;
  private eventSystem: EventSystem;
  private memory: Memory;
  private memoryPath: string;

  constructor(config: AnimusConfig) {
    if (typeof config.schema === 'string') {
      this.schema = JSON.parse(fs.readFileSync(config.schema, 'utf8')) as AgentSchema;
    } else {
      this.schema = config.schema;
    }

    this.memoryPath = config.memory ?? 'animus/agent.memory.json';
    this.engine = new StateEngine(this.schema);
    this.compiler = new Compiler(this.schema);
    this.eventSystem = new EventSystem(this.schema);
    this.memory = new Memory(this.memoryPath);

    const saved = this.memory.load();
    if (saved && this.memory.isCompatible(saved, this.schema)) {
      this.state = saved.state;
    } else {
      this.state = this.engine.initialState();
    }
  }

  /**
   * Compile current state to a mood-line paragraph.
   * Safe to call multiple times — does NOT advance state.
   * This is the ONLY state data that should be injected into an LLM prompt.
   */
  compile(): string {
    return this.compiler.compile(this.state);
  }

  /**
   * Apply events (typically parsed from an LLM response) and advance one tick.
   */
  apply(events: AnimusEvent[]): void {
    const kicks = this.eventSystem.toKicks(events);
    this.state = this.engine.tick(this.state, kicks);
  }

  /**
   * Advance one tick without any events (natural time-passage).
   */
  tick(): void {
    this.state = this.engine.tick(this.state);
  }

  /** Persist current state to the memory file. */
  save(): void {
    const data: MemoryFile = {
      schemaName: this.schema.name,
      variables: this.schema.variables,
      state: this.state,
      growth: { delightCount: 0, sessionCount: 0 },
      savedAt: Date.now(),
    };
    this.memory.save(data);
  }

  /** Reload state from the memory file, overwriting in-memory state. */
  load(): void {
    const saved = this.memory.load();
    if (saved && this.memory.isCompatible(saved, this.schema)) {
      this.state = saved.state;
    }
  }

  /** Returns raw state. For debugging/simulator only — do NOT inject into LLM prompts. */
  getState(): AgentState {
    return this.state;
  }

  getSchema(): AgentSchema {
    return this.schema;
  }
}

export type { AgentSchema, AgentState, AnimusEvent, MemoryFile };
export { EventSystem, StateEngine, Compiler, Memory };
export { BUILTIN_EVENTS } from './EventSystem';
