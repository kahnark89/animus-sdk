'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Memory = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class Memory {
    constructor(memoryPath) {
        this.memoryPath = memoryPath;
    }
    /** Load state from the memory file. Returns null if the file does not exist. */
    load() {
        if (!fs_1.default.existsSync(this.memoryPath))
            return null;
        const raw = fs_1.default.readFileSync(this.memoryPath, 'utf8');
        return JSON.parse(raw);
    }
    /**
     * Atomically persist state to the memory file.
     * Writes to a .tmp file first, then renames — prevents corrupt writes on crash.
     */
    save(data) {
        const dir = path_1.default.dirname(this.memoryPath);
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        const tmpPath = this.memoryPath + '.tmp';
        fs_1.default.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
        fs_1.default.renameSync(tmpPath, this.memoryPath);
    }
    /** True if the saved memory's variable list matches the current schema. */
    isCompatible(saved, schema) {
        const savedVars = [...(saved.variables ?? [])].sort().join(',');
        const schemaVars = [...(schema.variables ?? [])].sort().join(',');
        return savedVars === schemaVars;
    }
}
exports.Memory = Memory;
//# sourceMappingURL=Memory.js.map