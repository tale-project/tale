/**
 * Throughput canary — the aggregate performance contract.
 *
 * The per-pattern exec budget bounds one regex, not the whole pass; if a
 * future pattern regresses to quadratic behaviour on common shapes, the
 * correctness suites stay green while production p99 slips. This file
 * pins the aggregate: a full 50 KB input through every built-in pattern
 * across all 43 locales must finish well inside 1500 ms — deliberately
 * generous (typically sub-100 ms locally) so shared CI runners don't
 * flake, tight enough to catch catastrophic regressions.
 */

import { describe, expect, it } from 'vitest';

import { createScrubber } from '../../lib/pii';

const SCRUBBER_ALL = createScrubber({
  mode: 'mask',
  patterns: {
    email: true,
    phone: true,
    creditCard: true,
    cvc: true,
    iban: true,
    ipAddress: true,
    ssn: true,
    dateOfBirth: true,
    address: { locales: '*' },
    nationalId: { locales: '*' },
  },
});

const BUDGET_MS = 1500;

function repeatTo50Kb(block: string): string {
  return block.repeat(Math.ceil(50_000 / block.length)).slice(0, 50_000);
}

describe('throughput', () => {
  it('completes a 50 KB prose input under the budget', () => {
    const input = repeatTo50Kb(
      'The conference room was packed with engineers ready to demo. ' +
        'Reading a good book is always relaxing on a quiet weekend. ' +
        'Our team needs to ship the feature before Friday for the launch. ' +
        'The garden looks beautiful this time of year after the rain. ',
    );

    const start = performance.now();
    const outcome = SCRUBBER_ALL.scrub(input);
    const elapsed = performance.now() - start;

    expect(outcome.kind).toBe('pass');
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('completes a phone-saturated payload under the budget', () => {
    // The libphonenumber matcher's worst case — its cluster cap and
    // wall-clock budget must hold the line.
    const input = repeatTo50Kb(
      'Call us at +49 30 12345678, or +33 1 23 45 67 89, or +1 415 555 0142. ',
    );

    const start = performance.now();
    const outcome = SCRUBBER_ALL.scrub(input);
    const elapsed = performance.now() - start;

    expect(['modified', 'pass']).toContain(outcome.kind);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('completes a mixed-PII payload under the budget', () => {
    const input = repeatTo50Kb(
      'Contact alice@example.com or call +49 30 12345678. Card 4111111111111111. SSN 123-45-6789. ',
    );

    const start = performance.now();
    const outcome = SCRUBBER_ALL.scrub(input);
    const elapsed = performance.now() - start;

    expect(outcome.kind).toBe('modified');
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('sustains repeated scrub calls', () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      SCRUBBER_ALL.scrub('Contact alice@example.com for details');
    }
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('rebuilds a scrubber instance in under 50 ms', () => {
    // Composition caches are warm here (the module-level scrubber built
    // them); a warm rebuild must stay cheap so even a misused
    // build-per-request caller cannot blow up p99.
    const start = performance.now();
    createScrubber({
      mode: 'mask',
      patterns: { email: true, phone: true, address: { locales: '*' } },
    });
    expect(performance.now() - start).toBeLessThan(50);
  });
});
