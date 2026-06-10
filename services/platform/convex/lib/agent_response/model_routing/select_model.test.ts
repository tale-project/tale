import { describe, expect, it } from 'vitest';

import { selectModelTier } from './select_model';
import type { ModelCandidate } from './types';

const draft: ModelCandidate = {
  ref: 'p:draft',
  tier: 'draft',
  outputCentsPerMillion: 20,
};
const standard: ModelCandidate = {
  ref: 'p:standard',
  tier: 'standard',
  outputCentsPerMillion: 150,
};
const frontier: ModelCandidate = {
  ref: 'p:frontier',
  tier: 'frontier',
  outputCentsPerMillion: 1500,
};

describe('selectModelTier', () => {
  it('returns the only candidate', () => {
    const r = selectModelTier({
      candidates: [standard],
      difficultyClass: 'hard',
      domain: 'general',
    });
    expect(r.ref).toBe('p:standard');
    expect(r.reason).toBe('single-candidate');
  });

  it('maps difficulty class to tier (cheapest sufficient)', () => {
    const all = [draft, standard, frontier];
    expect(
      selectModelTier({
        candidates: all,
        difficultyClass: 'easy',
        domain: 'general',
      }).ref,
    ).toBe('p:draft');
    expect(
      selectModelTier({
        candidates: all,
        difficultyClass: 'medium',
        domain: 'general',
      }).ref,
    ).toBe('p:standard');
    expect(
      selectModelTier({
        candidates: all,
        difficultyClass: 'hard',
        domain: 'general',
      }).ref,
    ).toBe('p:frontier');
  });

  it('forces frontier for high-stakes domains regardless of difficulty', () => {
    const r = selectModelTier({
      candidates: [draft, standard, frontier],
      difficultyClass: 'easy',
      domain: 'legal',
    });
    expect(r.ref).toBe('p:frontier');
    expect(r.reason).toBe('high-stakes');
  });

  it('prefers a domain-tagged model at the target tier', () => {
    const coder: ModelCandidate = {
      ref: 'p:coder',
      tier: 'standard',
      routingTags: ['code'],
      outputCentsPerMillion: 180,
    };
    const r = selectModelTier({
      candidates: [draft, standard, coder, frontier],
      difficultyClass: 'medium',
      domain: 'code',
    });
    expect(r.ref).toBe('p:coder');
    expect(r.reason).toBe('domain-match');
  });

  it('infers tiers from cost when not declared (cheapest third → draft)', () => {
    const cands: ModelCandidate[] = [
      { ref: 'a', outputCentsPerMillion: 10 },
      { ref: 'b', outputCentsPerMillion: 100 },
      { ref: 'c', outputCentsPerMillion: 2000 },
    ];
    expect(
      selectModelTier({
        candidates: cands,
        difficultyClass: 'easy',
        domain: 'general',
      }).ref,
    ).toBe('a');
    expect(
      selectModelTier({
        candidates: cands,
        difficultyClass: 'hard',
        domain: 'general',
      }).ref,
    ).toBe('c');
  });

  it('keeps only vision-capable candidates on vision turns', () => {
    const cands: ModelCandidate[] = [
      { ref: 'text', tier: 'draft', outputCentsPerMillion: 10 },
      {
        ref: 'vision',
        tier: 'frontier',
        supportsVision: true,
        outputCentsPerMillion: 1500,
      },
    ];
    const r = selectModelTier({
      candidates: cands,
      difficultyClass: 'easy',
      domain: 'general',
      requiresVision: true,
    });
    expect(r.ref).toBe('vision');
  });
});

describe('quality-score interpolation (missing intelligence)', () => {
  it('prefers the higher declared quality among same-tier candidates', () => {
    const lo: ModelCandidate = {
      ref: 'p:lo',
      tier: 'standard',
      outputCentsPerMillion: 50,
      qualityScore: 0.2,
    };
    const hi: ModelCandidate = {
      ref: 'p:hi',
      tier: 'standard',
      outputCentsPerMillion: 60,
      qualityScore: 0.9,
    };
    const r = selectModelTier({
      candidates: [lo, hi],
      difficultyClass: 'medium',
      domain: 'general',
    });
    expect(r.ref).toBe('p:hi');
  });

  it('falls back to cost ordering when no candidate declares a quality score', () => {
    // Both standard, neither scored → equal interpolated (tier-default)
    // quality, so the cheaper one wins on the cost tiebreak.
    const a: ModelCandidate = {
      ref: 'p:a',
      tier: 'standard',
      outputCentsPerMillion: 100,
    };
    const b: ModelCandidate = {
      ref: 'p:b',
      tier: 'standard',
      outputCentsPerMillion: 40,
    };
    const r = selectModelTier({
      candidates: [a, b],
      difficultyClass: 'medium',
      domain: 'general',
    });
    expect(r.ref).toBe('p:b');
  });
});
