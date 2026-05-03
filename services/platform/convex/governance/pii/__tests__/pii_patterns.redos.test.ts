import { describe, expect, it } from 'vitest';

import { detectPii } from '../pii_detector';
import { getEnabledPatterns } from '../pii_patterns';

/**
 * Pathological-input regression for ReDoS. The v2 address regex fixed an
 * earlier `(${WTOK}|-)+` form that could blow up to >12s on 422-char inputs;
 * current shape uses bounded `{0,N}` quantifiers throughout. These tests pin
 * a generous 200ms wall-clock budget (5x the 50ms `execWithBudget` per-pattern
 * limit, leaving headroom for CI noise).
 */

const allPatterns = getEnabledPatterns([
  'email',
  'phone',
  'ssn',
  'creditCard',
  'cvc',
  'ipAddress',
  'dateOfBirth',
  'address',
  'iban',
  'germanId',
]);

const BUDGET_MS = 200;

function timed(input: string): number {
  const start = performance.now();
  detectPii(input, allPatterns);
  return performance.now() - start;
}

describe('ReDoS regression', () => {
  it('repeated DE address skeleton (3000 reps)', () => {
    const input = 'Hauptstrasse 123, 3. OG, '.repeat(3000);
    expect(timed(input)).toBeLessThan(BUDGET_MS);
  });

  it('repeated FR keyword (5000 reps)', () => {
    const input = 'rue de '.repeat(5000);
    expect(timed(input)).toBeLessThan(BUDGET_MS);
  });

  it('repeated EN address skeleton (3000 reps)', () => {
    const input = '123 Main '.repeat(3000);
    expect(timed(input)).toBeLessThan(BUDGET_MS);
  });

  it('long prose with embedded address at the end', () => {
    const input = 'abc def ghi '.repeat(1000) + 'Musterstraße 5, 10115 Berlin';
    expect(timed(input)).toBeLessThan(BUDGET_MS);
  });

  it('hyphen-heavy input does not catastrophically backtrack', () => {
    // A direct repro of the v2 initial-design failure: the prior
    // `(${WTOK}|-)+` form blew up here. The bounded `{0,4}` quantifier on
    // `(?:-${W}+){0,4}` keeps the engine linear-ish on this shape.
    const input = '1 rue de-la-'.repeat(2000);
    expect(timed(input)).toBeLessThan(BUDGET_MS);
  });

  it('very long single address line stays bounded', () => {
    const input =
      'Karl-Theodor-Straße 12345, 3. OG Wohnung 12, 10115 Berlin, Deutschland '.repeat(
        500,
      );
    expect(timed(input)).toBeLessThan(BUDGET_MS);
  });
});
