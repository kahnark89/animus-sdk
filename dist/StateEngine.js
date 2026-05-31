'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateEngine = void 0;
class StateEngine {
    constructor(schema) {
        this.schema = schema;
    }
    /**
     * Advance one timestep using the update equation:
     *   x(t+1) = clamp01( x(t)
     *     + λ·(x₀_eff − x(t))          // homeostasis
     *     + Σ κ_xj·(xj(t) − xj*)       // coupling
     *     + kicks[x]                    // event impulse
     *     + ε(t)                        // autocorrelated noise
     *   )
     */
    tick(state, kicks = {}) {
        const newValues = {};
        const newNoise = {};
        const nowMs = Date.now();
        for (const variable of this.schema.variables) {
            const x = state.values[variable] ?? this.schema.baselines[variable] ?? 0.5;
            const x0 = this.computeEffectiveBaseline(variable, nowMs);
            const lambda = this.schema.homeostasis_rate;
            const coupling = this.computeCoupling(variable, state);
            const kick = kicks[variable] ?? 0;
            const prevNoise = state.noise[variable] ?? 0;
            const noise = this.advanceNoise(prevNoise);
            newNoise[variable] = noise;
            newValues[variable] = StateEngine.clamp01(x + lambda * (x0 - x) + coupling + kick + noise);
        }
        return {
            values: newValues,
            noise: newNoise,
            tick: state.tick + 1,
            timestamp: nowMs,
        };
    }
    /**
     * Compute the effective baseline for a variable, applying circadian shift to energy.
     * nowMs override enables deterministic testing.
     */
    computeEffectiveBaseline(variable, nowMs) {
        const baseline = this.schema.baselines[variable] ?? 0.5;
        if (!this.schema.circadian || variable !== 'energy')
            return baseline;
        const now = new Date(nowMs ?? Date.now());
        const hour = now.getHours() + now.getMinutes() / 60;
        const peakHours = (this.schema.circadian.peaks ?? []).map((p) => {
            const [h, m] = p.split(':').map(Number);
            return h + m / 60;
        });
        const circFactor = peakHours.length > 0
            ? Math.max(...peakHours.map((pk) => (Math.cos(((hour - pk) * 2 * Math.PI) / 24) + 1) / 2))
            : 1.0;
        const floor = this.schema.circadian.floor ?? 0.0;
        return floor + (baseline - floor) * circFactor;
    }
    /**
     * Coupling contribution for a variable:
     *   Σ κ_xj · (xj(t) − xj*)
     * where xj* is the baseline of source variable j.
     */
    computeCoupling(variable, state) {
        const couplings = this.schema.coupling?.[variable];
        if (!couplings)
            return 0;
        let total = 0;
        for (const [src, kappa] of Object.entries(couplings)) {
            const srcVal = state.values[src] ?? this.schema.baselines[src] ?? 0.5;
            const srcBaseline = this.schema.baselines[src] ?? 0.5;
            total += kappa * (srcVal - srcBaseline);
        }
        return total;
    }
    /**
     * Advance autocorrelated noise one step:
     *   ε(t+1) = α·ε(t) + (1−α)·uniform(−mag, mag)
     */
    advanceNoise(current) {
        const mag = this.schema.noise?.magnitude ?? 0;
        const alpha = this.schema.noise?.autocorrelation ?? 0;
        const delta = (Math.random() * 2 - 1) * mag;
        return alpha * current + (1 - alpha) * delta;
    }
    static clamp01(v) {
        return Math.min(1, Math.max(0, v));
    }
    initialState() {
        const values = {};
        const noise = {};
        for (const v of this.schema.variables) {
            values[v] = this.schema.baselines[v] ?? 0.5;
            noise[v] = 0;
        }
        return { values, noise, tick: 0, timestamp: Date.now() };
    }
}
exports.StateEngine = StateEngine;
//# sourceMappingURL=StateEngine.js.map