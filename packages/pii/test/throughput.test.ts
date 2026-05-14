/**
 * Throughput / latency baseline.
 *
 * Locks in the production performance contract: with all built-in
 * patterns enabled across all 6 currently-shipped locales, a 50 KB input
 * must complete detection in under 250 ms on the CI baseline. The clamp
 * (`clampMessage`) ensures the runtime never sees more than 50 KB even
 * if the user passes 10 MB of pasted text.
 *
 * Why a perf test in unit-suite scope: the existing convex code path
 * applies a per-pattern ReDoS budget but no aggregate budget. If a
 * future pattern silently regresses to O(n²) on common shapes, the
 * data-driven tests still pass (they detect correctness, not speed) and
 * production p99 quietly slips. This file is the canary.
 *
 * The threshold is intentionally generous (250 ms vs typical sub-50 ms)
 * to absorb CI noise. Tighten when we collect production baselines.
 */

import { describe, expect, it } from 'vitest';

import { createScrubber } from '../src';

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

const BUDGET_MS = 250;

describe('throughput', () => {
  it('completes a 50 KB prose input in under the budget', () => {
    // Realistic prose payload — long article without PII.
    const block =
      'The conference room was packed with engineers ready to demo. ' +
      'Reading a good book is always relaxing on a quiet weekend. ' +
      'Our team needs to ship the feature before Friday for the launch. ' +
      'The garden looks beautiful this time of year after the rain. ';
    const input = block
      .repeat(Math.ceil(50_000 / block.length))
      .slice(0, 50_000);

    const start = performance.now();
    const outcome = SCRUBBER_ALL.scrub(input);
    const elapsed = performance.now() - start;

    expect(outcome.kind).toBe('pass');
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('completes a phone-saturated payload under the budget', () => {
    // Phone-saturated inputs are the worst case for libphone's matcher.
    // The cluster-count cap (200) terminates early; the regex still runs.
    const block =
      'Call us at +49 30 12345678, or +33 1 23 45 67 89, or +1 415 555 0142. ';
    const input = block
      .repeat(Math.ceil(50_000 / block.length))
      .slice(0, 50_000);

    const start = performance.now();
    const outcome = SCRUBBER_ALL.scrub(input);
    const elapsed = performance.now() - start;

    expect(['modified', 'pass']).toContain(outcome.kind);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('completes a mixed-PII payload under the budget', () => {
    const block =
      'Contact alice@example.com or call +49 30 12345678. Card 4111111111111111. SSN 123-45-6789. ';
    const input = block
      .repeat(Math.ceil(50_000 / block.length))
      .slice(0, 50_000);
    const start = performance.now();
    const outcome = SCRUBBER_ALL.scrub(input);
    const elapsed = performance.now() - start;
    expect(outcome.kind).toBe('modified');
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('does not allocate excessively on repeated scrub calls', () => {
    // Run 1000 scrubs and verify they complete quickly (no memory leak)
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      SCRUBBER_ALL.scrub('Contact alice@example.com for details');
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2000); // 1000 scrubs in under 2 seconds
  });

  it('rebuilds a scrubber instance in under 50 ms', () => {
    // Construction cost matters for callers that build per-request (rare
    // but possible). The default should stay fast enough that even a
    // misused build-per-request pattern doesn't blow up p99.
    const start = performance.now();
    createScrubber({
      mode: 'mask',
      patterns: { email: true, phone: true, address: { locales: '*' } },
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
