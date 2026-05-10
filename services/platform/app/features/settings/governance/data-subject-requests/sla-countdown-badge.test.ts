import { describe, expect, it } from 'vitest';

import { deriveSlaTone } from './sla-countdown-badge';

const DAY_MS = 86_400_000;
const NOW = 1_700_000_000_000;

describe('deriveSlaTone', () => {
  it('returns green when more than 7 days remain', () => {
    const result = deriveSlaTone({
      slaDeadlineAt: NOW + 8 * DAY_MS,
      status: 'pending',
      now: NOW,
    });
    expect(result.tone).toBe('green');
    expect(result.effectiveDeadline).toBe(NOW + 8 * DAY_MS);
  });

  it('returns yellow at exactly 7 days remaining', () => {
    const result = deriveSlaTone({
      slaDeadlineAt: NOW + 7 * DAY_MS,
      status: 'pending',
      now: NOW,
    });
    expect(result.tone).toBe('yellow');
  });

  it('returns yellow when 1 day remains', () => {
    const result = deriveSlaTone({
      slaDeadlineAt: NOW + DAY_MS,
      status: 'running',
      now: NOW,
    });
    expect(result.tone).toBe('yellow');
  });

  it('returns red when overdue', () => {
    const result = deriveSlaTone({
      slaDeadlineAt: NOW - DAY_MS,
      status: 'pending',
      now: NOW,
    });
    expect(result.tone).toBe('red');
    expect(result.remainingMs).toBeLessThan(0);
  });

  it('returns grey for terminal done status regardless of deadline', () => {
    const result = deriveSlaTone({
      slaDeadlineAt: NOW - DAY_MS,
      status: 'done',
      now: NOW,
    });
    expect(result.tone).toBe('grey');
  });

  it('returns grey for terminal failed status', () => {
    const result = deriveSlaTone({
      slaDeadlineAt: NOW + 5 * DAY_MS,
      status: 'failed',
      now: NOW,
    });
    expect(result.tone).toBe('grey');
  });

  it('keeps non-terminal coloring for partial / blocked', () => {
    // partial and blocked are retriable terminal-ish states but the SLA
    // is still actionable (admin can release a hold + retry, or counsel
    // can grant an extension), so the badge should keep counting down.
    expect(
      deriveSlaTone({
        slaDeadlineAt: NOW + 10 * DAY_MS,
        status: 'partial',
        now: NOW,
      }).tone,
    ).toBe('green');
    expect(
      deriveSlaTone({
        slaDeadlineAt: NOW + 3 * DAY_MS,
        status: 'blocked',
        now: NOW,
      }).tone,
    ).toBe('yellow');
  });

  it('uses extensionDeadlineAt when set, in preference to slaDeadlineAt', () => {
    // Original deadline lapsed; extension pushes it 30 days into the future.
    // Tone should be green based on the extended deadline, not red on the
    // original.
    const result = deriveSlaTone({
      slaDeadlineAt: NOW - 5 * DAY_MS,
      extensionDeadlineAt: NOW + 25 * DAY_MS,
      status: 'pending',
      now: NOW,
    });
    expect(result.tone).toBe('green');
    expect(result.effectiveDeadline).toBe(NOW + 25 * DAY_MS);
  });
});
