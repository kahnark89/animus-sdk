export interface AgentSchema {
    name: string;
    variables: string[];
    baselines: Record<string, number>;
    homeostasis_rate: number;
    coupling?: Record<string, Record<string, number>>;
    circadian?: {
        peaks: string[];
        floor: number;
    };
    noise?: {
        magnitude: number;
        autocorrelation: number;
    };
    events?: Record<string, Record<string, number>>;
    compiler?: {
        bands?: Record<string, {
            low: string;
            mid: string;
            high: string;
        }>;
        memory_injection?: boolean;
    };
    growth?: {
        rules: Array<{
            trigger: string;
            shifts: Record<string, number>;
        }>;
    };
}
export interface AgentState {
    values: Record<string, number>;
    noise: Record<string, number>;
    tick: number;
    timestamp: number;
}
export declare class StateEngine {
    private schema;
    constructor(schema: AgentSchema);
    /**
     * Advance one timestep using the update equation:
     *   x(t+1) = clamp01( x(t)
     *     + λ·(x₀_eff − x(t))          // homeostasis
     *     + Σ κ_xj·(xj(t) − xj*)       // coupling
     *     + kicks[x]                    // event impulse
     *     + ε(t)                        // autocorrelated noise
     *   )
     */
    tick(state: AgentState, kicks?: Record<string, number>): AgentState;
    /**
     * Compute the effective baseline for a variable, applying circadian shift to energy.
     * nowMs override enables deterministic testing.
     */
    computeEffectiveBaseline(variable: string, nowMs?: number): number;
    /**
     * Coupling contribution for a variable:
     *   Σ κ_xj · (xj(t) − xj*)
     * where xj* is the baseline of source variable j.
     */
    computeCoupling(variable: string, state: AgentState): number;
    /**
     * Advance autocorrelated noise one step:
     *   ε(t+1) = α·ε(t) + (1−α)·uniform(−mag, mag)
     */
    advanceNoise(current: number): number;
    static clamp01(v: number): number;
    initialState(): AgentState;
}
//# sourceMappingURL=StateEngine.d.ts.map