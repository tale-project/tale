import { describe, expect, it } from 'vitest';

import { shouldForceSummaryReentry } from './summary_reentry';

describe('shouldForceSummaryReentry', () => {
  const base = {
    terminalStatus: 'completed',
    summaryWritten: false,
    agentSessionId: 'sess_1',
    now: 1_000,
    hardDeadlineMs: 10_000,
    byo: true,
    gatewayToken: null,
  };

  it('fires for a clean BYO run that skipped summary.md', () => {
    expect(shouldForceSummaryReentry(base)).toBe(true);
  });

  it('fires for a managed run with a gateway token', () => {
    expect(
      shouldForceSummaryReentry({ ...base, byo: false, gatewayToken: 'vk_1' }),
    ).toBe(true);
  });

  it('does NOT fire when summary.md was actually written', () => {
    expect(shouldForceSummaryReentry({ ...base, summaryWritten: true })).toBe(
      false,
    );
  });

  it('does NOT fire on a non-completed terminal status', () => {
    expect(
      shouldForceSummaryReentry({ ...base, terminalStatus: 'failed' }),
    ).toBe(false);
    expect(
      shouldForceSummaryReentry({ ...base, terminalStatus: 'timeout' }),
    ).toBe(false);
  });

  it('does NOT fire without a resumable session handle', () => {
    expect(
      shouldForceSummaryReentry({ ...base, agentSessionId: undefined }),
    ).toBe(false);
  });

  it('does NOT fire once the hard deadline has passed', () => {
    expect(shouldForceSummaryReentry({ ...base, now: 10_001 })).toBe(false);
  });

  it('does NOT fire for a managed run with no gateway token (cannot auth)', () => {
    expect(
      shouldForceSummaryReentry({ ...base, byo: false, gatewayToken: null }),
    ).toBe(false);
  });

  it('does NOT fire when the run carried a terminal API error (laundered 401)', () => {
    // Every other gate passes (completed + no summary + resumable + budget +
    // BYO), but isError means the "completed" is a lie — re-entering would just
    // re-hit the dead token, so the run routes to the retryable throw instead.
    expect(shouldForceSummaryReentry({ ...base, isError: true })).toBe(false);
  });
});
