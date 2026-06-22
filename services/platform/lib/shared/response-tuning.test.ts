import { describe, expect, it } from 'vitest';

import {
  styleInstructionFragment,
  tuningInstructionSuffix,
  verbosityInstructionFragment,
} from './response-tuning';

describe('response-tuning fragments', () => {
  describe('style + verbosity fragments', () => {
    it('returns empty string when unset (no prompt fragment)', () => {
      expect(styleInstructionFragment(undefined)).toBe('');
      expect(verbosityInstructionFragment(undefined)).toBe('');
    });
    it('returns a non-empty fragment for each style/verbosity', () => {
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
    it('renders a single fragment when only one is set', () => {
      expect(tuningInstructionSuffix({ style: 'friendly' })).toContain(
        'friendly',
      );
      expect(tuningInstructionSuffix({ verbosity: 'verbose' })).toContain(
        'expansive',
      );
    });
  });
});
