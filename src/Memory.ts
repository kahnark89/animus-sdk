'use strict';

import fs from 'fs';
import path from 'path';
import { AgentSchema, AgentState } from './StateEngine';

export interface MemoryFile {
  schemaName: string;
  variables: string[];
  state: AgentState;
  growth: {
    delightCount: number;
    sessionCount: number;
  };
  savedAt: number;
}

export class Memory {
  private memoryPath: string;

  constructor(memoryPath: string) {
    this.memoryPath = memoryPath;
  }

  /** Load state from the memory file. Returns null if the file does not exist. */
  load(): MemoryFile | null {
    if (!fs.existsSync(this.memoryPath)) return null;
    const raw = fs.readFileSync(this.memoryPath, 'utf8');
    return JSON.parse(raw) as MemoryFile;
  }

  /**
   * Atomically persist state to the memory file.
   * Writes to a .tmp file first, then renames — prevents corrupt writes on crash.
   */
  save(data: MemoryFile): void {
    const dir = path.dirname(this.memoryPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpPath = this.memoryPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.memoryPath);
  }

  /** True if the saved memory's variable list matches the current schema. */
  isCompatible(saved: MemoryFile, schema: AgentSchema): boolean {
    const savedVars = [...(saved.variables ?? [])].sort().join(',');
    const schemaVars = [...(schema.variables ?? [])].sort().join(',');
    return savedVars === schemaVars;
  }
}
