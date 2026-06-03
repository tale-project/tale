/**
 * Meta tests for the framework itself.
 *
 * Verifies:
 *   1. The registry exposes one entry per `CheckId` literal.
 *   2. Every check's `id` matches a `CheckId`.
 *   3. The locale registry matches the runtime locale list (drift assertion
 *      is enforced at registry-load time; this is a redundant check for
 *      the test surface).
 *
 * Future: walk `locales/<locale>/planted/<check-id>/` and run each check
 * against its planted positive and negative fixture. Skipped for now —
 * planted fixtures exist (see `locales/<locale>/planted/`); the planted-
 * fixture-runner is a follow-up.
 */

import { describe, expect, it } from 'vitest';

import { ALL_LOCALES } from '../../locales';
import { LOCALE_REGISTRY } from '../locales';
import { CHECKS } from '../registry';

const EXPECTED_CHECK_IDS = [
  'parity',
  'usage',
  'source-unicode-escape',
  'pronouns-formal',
  'terminology-loanword',
  'terminology-half-compound',
  'terminology-ui-label',
  'voice-strikes',
  'voice-drift',
  'grammar-articles',
  'style-quotes',
  'style-apostrophes',
  'style-em-dash',
  'style-en-dash',
  'style-nbsp',
  'style-numbers',
  'style-dates',
  'style-percent-nbsp',
  'style-currency',
  'style-ss',
  'icu-placeholder-parity',
  'icu-plural-rules',
  'glossary-coverage',
  'status-chatter',
  'prose-exclamation',
  'markdown-anchor-parity',
  'markdown-link-target',
  'placeholder-density',
] as const;

describe('framework meta', () => {
  it('registry includes every CheckId', () => {
    const ids = CHECKS.map((c) => c.id).sort();
    const expected = [...EXPECTED_CHECK_IDS].sort();
    expect(ids).toEqual(expected);
  });

  it('every check has a stable id, scope, defaultMode, and run', () => {
    for (const check of CHECKS) {
      expect(typeof check.id).toBe('string');
      expect(['json', 'markdown', 'both']).toContain(check.scope);
      expect(['enforce', 'report', 'off']).toContain(check.defaultMode);
      expect(typeof check.run).toBe('function');
    }
  });

  it('locale registry matches the runtime locale list', () => {
    const testIds = LOCALE_REGISTRY.map((l) => l.id).sort();
    const runtimeIds = [...ALL_LOCALES].sort();
    expect(testIds).toEqual(runtimeIds);
  });

  it('every locale config has the required concern fields', () => {
    for (const locale of LOCALE_REGISTRY) {
      expect(locale.style).toBeDefined();
      expect(locale.voice).toBeDefined();
      expect(locale.terminology).toBeDefined();
      expect(locale.grammar).toBeDefined();
      expect(locale.patterns).toBeDefined();
      expect(locale.doctrine).toMatch(/\.agents\/translation\/locales\//);
    }
  });
});
