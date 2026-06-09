/**
 * Per-complexity acceptance thresholds and presets for response-quality
 * scoring. Ported from `old_router/cascadeflow/quality/quality.py`
 * (`QualityConfig.for_production / for_development / for_cascade`).
 *
 * `complexity` here is the governor's coarse difficulty class (easy / medium /
 * hard) — callers map their 5-level or continuous difficulty onto these.
 */

export type QualityComplexity = 'easy' | 'medium' | 'hard';

export type QualityPreset = 'lenient' | 'balanced' | 'strict';

export interface QualityThresholds {
  /** Minimum overall quality score to accept, per complexity. */
  confidence: Record<QualityComplexity, number>;
  /** Minimum word count expected, per complexity. */
  minWords: Record<QualityComplexity, number>;
  /** Maximum word count before "too long" penalty, per complexity. */
  maxWords: Record<QualityComplexity, number>;
  /** Minimum specificity score required, per complexity. */
  minSpecificity: Record<QualityComplexity, number>;
  /** Hedging ratio above this is penalized. */
  maxHedgingRatio: number;
}

/**
 * `balanced` reproduces cascade-optimized thresholds (≈50–60% draft acceptance
 * at 94%+ quality). `lenient` accepts more (favors cost/latency), `strict`
 * accepts less (favors quality). Selected per agent via `qualityProfile`.
 */
export const QUALITY_PRESETS: Record<QualityPreset, QualityThresholds> = {
  lenient: {
    confidence: { easy: 0.3, medium: 0.45, hard: 0.6 },
    minWords: { easy: 1, medium: 8, hard: 20 },
    maxWords: { easy: 80, medium: 320, hard: 1200 },
    minSpecificity: { easy: 0, medium: 0.15, hard: 0.3 },
    maxHedgingRatio: 0.4,
  },
  balanced: {
    confidence: { easy: 0.45, medium: 0.6, hard: 0.72 },
    minWords: { easy: 1, medium: 10, hard: 30 },
    maxWords: { easy: 60, medium: 300, hard: 1000 },
    minSpecificity: { easy: 0, medium: 0.2, hard: 0.4 },
    maxHedgingRatio: 0.3,
  },
  strict: {
    confidence: { easy: 0.6, medium: 0.72, hard: 0.85 },
    minWords: { easy: 1, medium: 12, hard: 40 },
    maxWords: { easy: 50, medium: 280, hard: 900 },
    minSpecificity: { easy: 0.1, medium: 0.3, hard: 0.5 },
    maxHedgingRatio: 0.2,
  },
};

export function thresholdsFor(preset: QualityPreset): QualityThresholds {
  return QUALITY_PRESETS[preset];
}
