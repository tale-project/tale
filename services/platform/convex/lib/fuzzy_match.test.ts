import { describe, expect, it } from 'vitest';

import {
  fuzzyMatchFolder,
  fuzzyMatchTitle,
  levenshteinDistance,
} from './fuzzy_match';

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns length of other string when one is empty', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('calculates single substitution', () => {
    expect(levenshteinDistance('cat', 'car')).toBe(1);
  });

  it('calculates single insertion', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
  });

  it('calculates single deletion', () => {
    expect(levenshteinDistance('cats', 'cat')).toBe(1);
  });

  it('calculates multiple edits', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  it('handles completely different strings', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(3);
  });
});

describe('fuzzyMatchFolder', () => {
  const candidates = [
    { name: 'contracts', id: 'f1' },
    { name: 'marketing', id: 'f2' },
    { name: 'reports', id: 'f3' },
  ];

  describe('case-insensitive exact match', () => {
    it('matches exact name', () => {
      const result = fuzzyMatchFolder('contracts', candidates);
      expect(result).toEqual({ match: { name: 'contracts', id: 'f1' } });
    });

    it('matches with different case', () => {
      const result = fuzzyMatchFolder('Contracts', candidates);
      expect(result).toEqual({ match: { name: 'contracts', id: 'f1' } });
    });

    it('matches uppercase', () => {
      const result = fuzzyMatchFolder('MARKETING', candidates);
      expect(result).toEqual({ match: { name: 'marketing', id: 'f2' } });
    });
  });

  describe('prefix match', () => {
    it('matches when target is prefix of candidate', () => {
      const result = fuzzyMatchFolder('contract', candidates);
      expect(result).toEqual({ match: { name: 'contracts', id: 'f1' } });
    });

    it('returns suggestions when multiple prefix matches', () => {
      const withSimilar = [
        ...candidates,
        { name: 'contractors', id: 'f4' },
        { name: 'contract-templates', id: 'f5' },
      ];
      const result = fuzzyMatchFolder('contract', withSimilar);
      if (!result || !('suggestions' in result)) {
        throw new Error('Expected suggestions result');
      }
      expect(result.suggestions).toContain('contracts');
      expect(result.suggestions).toContain('contractors');
      expect(result.suggestions).toContain('contract-templates');
    });
  });

  describe('levenshtein match', () => {
    it('matches with typo (singular vs plural)', () => {
      // "contracs" → "contracts" (distance 1)
      const result = fuzzyMatchFolder('contracs', candidates);
      expect(result).toEqual({ match: { name: 'contracts', id: 'f1' } });
    });

    it('matches with minor spelling error', () => {
      // "marketng" → "marketing" (distance 1)
      const result = fuzzyMatchFolder('marketng', candidates);
      expect(result).toEqual({ match: { name: 'marketing', id: 'f2' } });
    });
  });

  describe('no match', () => {
    it('returns null when nothing matches', () => {
      const result = fuzzyMatchFolder('finances', candidates);
      expect(result).toBeNull();
    });

    it('returns null for empty candidates', () => {
      const result = fuzzyMatchFolder('test', []);
      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles single-character target', () => {
      const result = fuzzyMatchFolder('c', [{ name: 'contracts', id: 'f1' }]);
      // 'c' is a prefix of 'contracts'
      expect(result).toEqual({ match: { name: 'contracts', id: 'f1' } });
    });

    it('returns suggestions for ambiguous single-char prefix', () => {
      const result = fuzzyMatchFolder('c', [
        { name: 'contracts', id: 'f1' },
        { name: 'clients', id: 'f2' },
      ]);
      if (!result || !('suggestions' in result)) {
        throw new Error('Expected suggestions result');
      }
      expect(result.suggestions).toHaveLength(2);
    });
  });
});

describe('fuzzyMatchTitle', () => {
  describe('substring match (existing behavior)', () => {
    it('matches exact substring', () => {
      expect(fuzzyMatchTitle('contract', 'contracts_2024.pdf')).toBe(true);
    });

    it('matches case-insensitive substring', () => {
      expect(fuzzyMatchTitle('Contract', 'my_contracts_2024.pdf')).toBe(true);
    });

    it('does not match unrelated string', () => {
      expect(fuzzyMatchTitle('invoice', 'contracts_2024.pdf')).toBe(false);
    });
  });

  describe('token-based fuzzy match', () => {
    it('matches when query tokens fuzzy-match title tokens', () => {
      // "contracs 2024" tokens: ["contracs", "2024"]
      // "contracts_2024.pdf" tokens: ["contracts", "2024", "pdf"]
      // "contracs" ~ "contracts" (levenshtein 1), "2024" = "2024"
      expect(fuzzyMatchTitle('contracs 2024', 'contracts_2024.pdf')).toBe(true);
    });

    it('matches with different separators', () => {
      expect(fuzzyMatchTitle('Q1 report', 'Q1_report_final.docx')).toBe(true);
    });

    it('matches when query token is prefix of title token', () => {
      expect(fuzzyMatchTitle('market', 'marketing_plan.pdf')).toBe(true);
    });

    it('matches when title token is prefix of query token', () => {
      expect(fuzzyMatchTitle('contracts', 'contract_2024.pdf')).toBe(true);
    });

    it('does not match when tokens are unrelated', () => {
      expect(fuzzyMatchTitle('invoice 2024', 'contracts_2023.pdf')).toBe(false);
    });

    it('handles empty query', () => {
      expect(fuzzyMatchTitle('', 'contracts.pdf')).toBe(true); // empty string is substring of anything
    });

    it('matches with typo in file name query', () => {
      // "reportt" ~ "report" (levenshtein 1)
      expect(fuzzyMatchTitle('reportt', 'annual_report.pdf')).toBe(true);
    });
  });
});
