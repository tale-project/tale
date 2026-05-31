import { describe, expect, it } from 'vitest';

import {
  creativityToScoreOverride,
  effortToTierOverride,
  isCreativityProfile,
  isEffortProfile,
  isStyleProfile,
  styleInstructionFragment,
} from './composer-profiles';

describe('composer-profiles mappings', () => {
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

  describe('styleInstructionFragment', () => {
    it('returns empty string for adaptive / unset (no prompt override)', () => {
      expect(styleInstructionFragment('adaptive')).toBe('');
      expect(styleInstructionFragment(undefined)).toBe('');
    });
    it('returns a non-empty fragment for each fixed style', () => {
      for (const style of [
        'concise',
        'detailed',
        'formal',
        'friendly',
      ] as const) {
        expect(styleInstructionFragment(style).length).toBeGreaterThan(0);
      }
    });
  });

  describe('type guards', () => {
    it('accept valid values and reject junk', () => {
      expect(isEffortProfile('high')).toBe(true);
      expect(isEffortProfile('nope')).toBe(false);
      expect(isCreativityProfile('balanced')).toBe(true);
      expect(isCreativityProfile('')).toBe(false);
      expect(isStyleProfile('formal')).toBe(true);
      expect(isStyleProfile('formals')).toBe(false);
    });
  });
});
