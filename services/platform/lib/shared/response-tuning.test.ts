import { describe, expect, it } from 'vitest';

import {
  creativityToScoreOverride,
  effortToTierOverride,
  styleInstructionFragment,
  tuningInstructionSuffix,
  verbosityInstructionFragment,
} from './response-tuning';

describe('response-tuning mappings', () => {
  describe('effortToTierOverride', () => {
    it('returns undefined for adaptive / unset (keeps the governor in charge)', () => {
      expect(effortToTierOverride('adaptive')).toBeUndefined();
      expect(effortToTierOverride(undefined)).toBeUndefined();
    });
    it('maps fixed efforts straight to reasoning tiers', () => {
      expect(effortToTierOverride('low')).toBe('low');
      expect(effortToTierOverride('medium')).toBe('medium');
      expect(effortToTierOverride('high')).toBe('high');
    });
  });

  describe('creativityToScoreOverride', () => {
    it('returns undefined for adaptive / unset', () => {
      expect(creativityToScoreOverride('adaptive')).toBeUndefined();
      expect(creativityToScoreOverride(undefined)).toBeUndefined();
    });
    it('maps fixed creativity to a [0,1] score', () => {
      expect(creativityToScoreOverride('precise')).toBe(0);
      expect(creativityToScoreOverride('balanced')).toBe(0.5);
      expect(creativityToScoreOverride('creative')).toBe(1);
    });
  });

  describe('style + verbosity fragments', () => {
    it('returns empty string for adaptive / unset (no prompt override)', () => {
      expect(styleInstructionFragment('adaptive')).toBe('');
      expect(styleInstructionFragment(undefined)).toBe('');
      expect(verbosityInstructionFragment('adaptive')).toBe('');
      expect(verbosityInstructionFragment(undefined)).toBe('');
    });
    it('returns a non-empty fragment for each fixed style/verbosity', () => {
      for (const style of [
        'concise',
        'detailed',
        'formal',
        'friendly',
      ] as const) {
        expect(styleInstructionFragment(style).length).toBeGreaterThan(0);
      }
      for (const v of ['terse', 'normal', 'verbose'] as const) {
        expect(verbosityInstructionFragment(v).length).toBeGreaterThan(0);
      }
    });
  });

  describe('tuningInstructionSuffix', () => {
    it('is empty when nothing is set', () => {
      expect(tuningInstructionSuffix(undefined)).toBe('');
      expect(tuningInstructionSuffix({})).toBe('');
      expect(
        tuningInstructionSuffix({ style: 'adaptive', verbosity: 'adaptive' }),
      ).toBe('');
    });
    it('joins style and verbosity when both set', () => {
      const out = tuningInstructionSuffix({
        style: 'concise',
        verbosity: 'terse',
      });
      expect(out).toContain('concise');
      expect(out).toContain('few words');
      expect(out.split('\n').length).toBe(2);
    });
  });
});
