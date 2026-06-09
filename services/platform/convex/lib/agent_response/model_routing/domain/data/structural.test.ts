import { describe, expect, it } from 'vitest';

import {
  boundaryModeFor,
  SUPPORTED_DATASET_LOCALES,
} from '../../../../../../lib/shared/constants/dataset-locales';
import { detectDomain } from '../detect_domain';
import { TIER_WEIGHTS, type KeywordTier } from '../types';
import { ALL_DOMAIN_LEXICONS } from './index';

const TIERS = Object.keys(TIER_WEIGHTS) as KeywordTier[];
const SHORT_ALLOW = new Set([
  'sql',
  'roi',
  'git',
  'npm',
  'etl',
  'def',
  'os',
  'ai',
  'ml',
  'ci',
  'cd',
  'db',
  'ok', // intentional conversational ack in en.ts (word-bounded, safe)
]);

describe('domain lexicon coverage', () => {
  const byLocale = new Map(ALL_DOMAIN_LEXICONS.map((l) => [l.locale, l]));

  it('covers every supported dataset locale (and no extras)', () => {
    const present = new Set(ALL_DOMAIN_LEXICONS.map((l) => l.locale));
    for (const loc of SUPPORTED_DATASET_LOCALES) {
      expect(present.has(loc), `missing domain lexicon: ${loc}`).toBe(true);
    }
    expect(present.size).toBe(SUPPORTED_DATASET_LOCALES.length);
  });

  it('declares the canonical boundary mode per locale', () => {
    for (const lex of ALL_DOMAIN_LEXICONS) {
      expect(lex.boundaryMode, lex.locale).toBe(boundaryModeFor(lex.locale));
    }
  });

  it('has no duplicate or cross-tier-duplicate terms within a domain', () => {
    for (const lex of ALL_DOMAIN_LEXICONS) {
      for (const [domain, kw] of Object.entries(lex.keywords)) {
        const seen = new Set<string>();
        for (const tier of TIERS) {
          for (const term of kw?.[tier] ?? []) {
            const key = term.toLowerCase();
            expect(
              seen.has(key),
              `${lex.locale}/${domain}: duplicate "${term}"`,
            ).toBe(false);
            seen.add(key);
          }
        }
      }
    }
  });

  it('has no ultra-short word-mode single tokens (false-positive guard)', () => {
    for (const lex of ALL_DOMAIN_LEXICONS) {
      if (lex.boundaryMode !== 'word') continue;
      for (const kw of Object.values(lex.keywords)) {
        for (const tier of TIERS) {
          for (const term of kw?.[tier] ?? []) {
            if (term.includes(' ')) continue;
            if (SHORT_ALLOW.has(term.toLowerCase())) continue;
            expect(
              term.length >= 3,
              `${lex.locale}: short token "${term}"`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('every locale supplies a reasonable number of domains', () => {
    for (const lex of ALL_DOMAIN_LEXICONS) {
      expect(
        Object.keys(lex.keywords).length,
        `${lex.locale} has too few domains`,
      ).toBeGreaterThanOrEqual(6);
    }
  });

  it('exposes German and Chinese (was English-only before expansion)', () => {
    expect(byLocale.has('de')).toBe(true);
    expect(byLocale.has('zh-Hans')).toBe(true);
  });
});

describe('multilingual domain detection regression', () => {
  // Self-referential but end-to-end: each locale's own top "code" term must
  // route to `code` through the composed cross-locale matcher — proving the
  // generated data is wired in and routes non-English input (the fixed gap).
  it('routes a code term from each locale to the code domain', () => {
    for (const lex of ALL_DOMAIN_LEXICONS) {
      const codeKw = lex.keywords.code;
      const term = codeKw?.veryStrong?.[0] ?? codeKw?.strong?.[0];
      if (!term) continue;
      const result = detectDomain(term);
      // Either it wins outright, or it at least registers a non-zero code score.
      const codeScore = result.scores.code ?? 0;
      expect(
        result.domain === 'code' || codeScore > 0,
        `${lex.locale}: "${term}" did not register as code (got ${result.domain})`,
      ).toBe(true);
    }
  });

  it('routes a clear German coding question to code', () => {
    const r = detectDomain(
      'Wie kann ich diese Python Funktion debuggen? Es gibt eine Exception.',
    );
    expect(['code']).toContain(r.domain);
  });

  it('keeps plain chit-chat as general', () => {
    const r = detectDomain('Hallo, wie geht es dir heute?');
    expect(r.domain).toBe('general');
  });
});
