'use strict';

import { AnimusEvent } from '../EventSystem';

export interface CortexMapping {
  lowConfidenceGENOTYPE: { threshold: number; event: string; intensity: number };
  multipleOpenQuestions: { threshold: number; event: string; intensity: number };
  overallHealthGreen:    { event: string; intensity: number };
}

export const DEFAULT_MAPPING: CortexMapping = {
  lowConfidenceGENOTYPE: { threshold: 0.40, event: 'confusion', intensity: 0.30 },
  multipleOpenQuestions: { threshold: 3,    event: 'confusion', intensity: 0.40 },
  overallHealthGreen:    { event: 'delight', intensity: 0.20 },
};

// Minimal shape of the bundle we need — avoids importing from cortex-dev directly
interface ConceptEntry {
  concept: string;
  criticality: string;
  score: number;
}

interface CortexContextBundle {
  genome: {
    openQuestions: string[];
  };
  comprehension: {
    riskConcepts: ConceptEntry[];
    overallHealth: 'green' | 'yellow' | 'red';
  };
}

/**
 * Convert a CortexContextBundle into AnimusEvent[].
 * Mapping logic:
 *   - 3+ open questions               → confusion at 0.40
 *   - Any GENOTYPE concept score <0.40 → confusion at 0.30  (one event, not per-concept)
 *   - overallHealth === 'green'        → delight at 0.20
 */
export function cortexToEvents(
  bundle: CortexContextBundle,
  mapping: Partial<CortexMapping> = {}
): AnimusEvent[] {
  const m: CortexMapping = { ...DEFAULT_MAPPING, ...mapping };
  const events: AnimusEvent[] = [];

  const openQuestions = bundle.genome.openQuestions ?? [];
  if (openQuestions.length >= m.multipleOpenQuestions.threshold) {
    events.push({ type: m.multipleOpenQuestions.event, intensity: m.multipleOpenQuestions.intensity });
  }

  const lowGenoConfidence = (bundle.comprehension.riskConcepts ?? []).some(
    (c) => c.criticality === 'GENOTYPE' && c.score < m.lowConfidenceGENOTYPE.threshold
  );
  if (lowGenoConfidence) {
    events.push({ type: m.lowConfidenceGENOTYPE.event, intensity: m.lowConfidenceGENOTYPE.intensity });
  }

  if (bundle.comprehension.overallHealth === 'green') {
    events.push({ type: m.overallHealthGreen.event, intensity: m.overallHealthGreen.intensity });
  }

  return events;
}
