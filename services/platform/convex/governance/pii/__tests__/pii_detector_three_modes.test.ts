import { describe, expect, it, vi } from 'vitest';

import { dedupOverlaps, detectPii } from '../pii_detector';
import type { PiiPattern } from '../pii_patterns';

/**
 * Verifies the three pattern shapes wired through `pii_detector.ts` and the
 * try/catch defenses around user-supplied `detect`/`validate` callbacks.
 *
 * Order of `BUILT_IN_PII_PATTERNS` is the implicit tie-breaker for equal-span
 * dedup; this file pins that contract so a later refactor can't silently
 * change which pattern wins.
 */

describe('PiiPattern three modes', () => {
  it('mode A: pure regex matches and is recompiled fresh per call', () => {
    const pattern: PiiPattern = {
      name: 'word',
      regex: /\bfoo\b/g,
      replacement: '[X]',
    };
    const matches = detectPii('foo and foo and bar', [pattern]);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.matchedText)).toEqual(['foo', 'foo']);
  });

  it('mode B: regex + validate keeps only matches that pass the post-filter', () => {
    const pattern: PiiPattern = {
      name: 'evens',
      regex: /\b\d+\b/g,
      validate: (m) => Number(m) % 2 === 0,
      replacement: '[EVEN]',
    };
    const matches = detectPii('1 2 3 4 5 6', [pattern]);
    expect(matches.map((m) => m.matchedText)).toEqual(['2', '4', '6']);
  });

  it('mode C: detect-only function bypasses execWithBudget', () => {
    const detect = vi.fn(() => [
      { start: 0, end: 3, matchedText: 'abc' },
      { start: 4, end: 7, matchedText: 'def' },
    ]);
    const pattern: PiiPattern = {
      name: 'mock',
      detect,
      replacement: '[M]',
    };
    const matches = detectPii('abc def', [pattern]);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(matches).toHaveLength(2);
  });
});

describe('PiiPattern error containment (GDPR)', () => {
  it('detect() throwing is logged with pattern name only — never the input', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const pattern: PiiPattern = {
      name: 'bomb',
      detect: () => {
        throw new Error('contains-secret-payload-DO-NOT-LEAK');
      },
      replacement: '[X]',
    };
    const matches = detectPii('any input here', [pattern]);
    expect(matches).toEqual([]);
    expect(debugSpy).toHaveBeenCalled();
    const log = debugSpy.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(log).toContain('pattern bomb');
    expect(log).not.toContain('contains-secret-payload');
    expect(log).not.toContain('any input here');
    debugSpy.mockRestore();
  });

  it('validate() throwing skips that match but keeps iterating', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const pattern: PiiPattern = {
      name: 'flaky',
      regex: /\b\d+\b/g,
      validate: (m) => {
        if (m === '42') throw new Error('secret-' + m);
        return true;
      },
      replacement: '[N]',
    };
    const matches = detectPii('1 42 3', [pattern]);
    // 1 and 3 survive; 42 is dropped (validate threw)
    expect(matches.map((m) => m.matchedText)).toEqual(['1', '3']);
    const log = debugSpy.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(log).toContain('pattern flaky');
    expect(log).not.toContain('secret-');
    expect(log).not.toContain('42');
    debugSpy.mockRestore();
  });

  it('pattern with neither regex nor detect is logged and skipped (no NPE)', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const pattern: PiiPattern = {
      name: 'malformed',
      replacement: '[X]',
    };
    expect(() => detectPii('hello', [pattern])).not.toThrow();
    expect(debugSpy).toHaveBeenCalled();
    debugSpy.mockRestore();
  });
});

describe('dedupOverlaps', () => {
  it('drops fully-contained shorter matches', () => {
    const result = dedupOverlaps([
      {
        patternName: 'a',
        start: 0,
        end: 5,
        matchedText: 'short',
        replacement: '[A]',
      },
      {
        patternName: 'b',
        start: 0,
        end: 10,
        matchedText: 'longerword',
        replacement: '[B]',
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].patternName).toBe('b');
  });

  it('on equal-span overlap, keeps first-inserted (BUILT_IN_PII_PATTERNS order)', () => {
    const result = dedupOverlaps([
      {
        patternName: 'first',
        start: 0,
        end: 5,
        matchedText: 'hello',
        replacement: '[F]',
      },
      {
        patternName: 'second',
        start: 0,
        end: 5,
        matchedText: 'hello',
        replacement: '[S]',
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].patternName).toBe('first');
  });

  it('keeps non-overlapping matches as-is', () => {
    const result = dedupOverlaps([
      {
        patternName: 'a',
        start: 0,
        end: 3,
        matchedText: 'foo',
        replacement: '[A]',
      },
      {
        patternName: 'b',
        start: 4,
        end: 7,
        matchedText: 'bar',
        replacement: '[B]',
      },
    ]);
    expect(result).toHaveLength(2);
  });
});
