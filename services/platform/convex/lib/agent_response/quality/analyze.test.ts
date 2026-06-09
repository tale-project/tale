import { describe, expect, it } from 'vitest';

import { analyzeResponseQuality } from './analyze';
import { thresholdsFor } from './thresholds';

const balanced = thresholdsFor('balanced');

describe('analyzeResponseQuality', () => {
  it('accepts a specific, confident answer', () => {
    const r = analyzeResponseQuality({
      text: 'The capital of France is Paris, established as the capital in 987 AD. It has a population of roughly 2.1 million.',
      complexity: 'easy',
      thresholds: balanced,
    });
    expect(r.accept).toBe(true);
    expect(r.score).toBeGreaterThan(0.7);
  });

  it('hard-fails a severe refusal', () => {
    const r = analyzeResponseQuality({
      text: "I'm not sure and I don't know the answer to that.",
      complexity: 'medium',
      thresholds: balanced,
    });
    expect(r.accept).toBe(false);
    expect(r.reason).toBe('severe-uncertainty');
    expect(r.signals.severeUncertainty).toBe(true);
  });

  it('penalizes excessive hedging', () => {
    const hedged = analyzeResponseQuality({
      text: 'It might be this. It could possibly be that. Perhaps it depends. Maybe it is unclear.',
      complexity: 'medium',
      thresholds: balanced,
    });
    expect(hedged.signals.hedgingRatio).toBeGreaterThan(0.3);
    expect(hedged.score).toBeLessThan(1);
  });

  it('never double-counts overlapping hedging forms ("maybe" is not also "may")', () => {
    const single = analyzeResponseQuality({
      text: 'Maybe.',
      complexity: 'easy',
      thresholds: balanced,
    });
    // One sentence, one distinct hedge ("maybe") → ratio exactly 1, not 2.
    expect(single.signals.hedgingRatio).toBe(1);
  });

  it('clamps the score to the [0,1] lower bound when penalties stack', () => {
    // Severe uncertainty + heavy hedging + vagueness + a hallucination pattern
    // would sum well past -1; the score must floor at 0, never go negative.
    const r = analyzeResponseQuality({
      text: "I'm not sure, but maybe according to studies show various stuff might possibly be something.",
      complexity: 'hard',
      thresholds: balanced,
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it('flags an over-long answer via the tooLong signal', () => {
    const r = analyzeResponseQuality({
      text: 'word '.repeat(5000),
      complexity: 'easy',
      thresholds: balanced,
    });
    expect(r.signals.tooLong).toBe(true);
  });

  it('flags too-short answers for hard complexity', () => {
    const r = analyzeResponseQuality({
      text: 'Yes.',
      complexity: 'hard',
      thresholds: balanced,
    });
    expect(r.signals.tooShort).toBe(true);
    expect(r.accept).toBe(false);
  });

  it('applies math leniency (a severe-uncertainty marker is not a hard fail for math)', () => {
    // This input carries a SEVERE uncertainty marker ("i'm not sure") AND an
    // actual numeric answer — the exact case math leniency exists for. Without
    // leniency it hard-fails (severe penalty + reject); with it, the severe
    // penalty is skipped, so the two branches must genuinely diverge.
    const input = "I'm not sure but the integral evaluates to 42.";
    const strict = analyzeResponseQuality({
      text: input,
      complexity: 'easy',
      thresholds: balanced,
    });
    const lenient = analyzeResponseQuality({
      text: input,
      complexity: 'easy',
      thresholds: balanced,
      isMathLike: true,
    });
    expect(lenient.score).toBeGreaterThan(strict.score);
    expect(strict.accept).toBe(false); // severe-uncertainty hard fail
    expect(lenient.reason).not.toBe('severe-uncertainty');
  });

  it('detects hallucination patterns', () => {
    const r = analyzeResponseQuality({
      text: 'According to studies show this is true, and scientists agree exactly 73.2% of cases confirm it.',
      complexity: 'medium',
      thresholds: balanced,
    });
    expect(r.signals.hallucinationRisk).not.toBe('low');
  });

  it('stricter preset accepts less than lenient', () => {
    const text = 'It probably works in most cases, generally speaking.';
    const lenient = analyzeResponseQuality({
      text,
      complexity: 'medium',
      thresholds: thresholdsFor('lenient'),
    });
    const strict = analyzeResponseQuality({
      text,
      complexity: 'medium',
      thresholds: thresholdsFor('strict'),
    });
    expect(lenient.score).toBeGreaterThanOrEqual(strict.score - 0.0001);
    // Strict threshold is higher, so acceptance is at most as permissive.
    expect(Number(strict.accept)).toBeLessThanOrEqual(Number(lenient.accept));
  });
});
