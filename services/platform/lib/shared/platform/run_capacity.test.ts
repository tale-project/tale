import { describe, expect, it } from 'vitest';

import { deriveRunIndicator, isParkedOnCapacity } from './run_capacity';

describe('isParkedOnCapacity', () => {
  it('is true when an active run carries the sticky awaiting-capacity slug', () => {
    expect(
      isParkedOnCapacity({
        status: 'running',
        awaitingCapacityStepSlug: 'implement_fix',
      }),
    ).toBe(true);
    expect(
      isParkedOnCapacity({
        status: 'pending',
        awaitingCapacityStepSlug: 'implement_fix',
      }),
    ).toBe(true);
  });

  it('is false when the slug is unset (the common, running case)', () => {
    expect(isParkedOnCapacity({ status: 'running' })).toBe(false);
    expect(
      isParkedOnCapacity({
        status: 'running',
        awaitingCapacityStepSlug: undefined,
      }),
    ).toBe(false);
  });

  it('ignores a stale slug left on a settled run (never a stale chip)', () => {
    // A run that finished/failed without the admission path clearing the flag
    // must not surface as "queued".
    expect(
      isParkedOnCapacity({
        status: 'completed',
        awaitingCapacityStepSlug: 'implement_fix',
      }),
    ).toBe(false);
    expect(
      isParkedOnCapacity({
        status: 'failed',
        awaitingCapacityStepSlug: 'implement_fix',
      }),
    ).toBe(false);
  });

  it('is false when there is no execution at all', () => {
    expect(isParkedOnCapacity(null)).toBe(false);
    expect(isParkedOnCapacity(undefined)).toBe(false);
  });
});

describe('deriveRunIndicator', () => {
  it("surfaces 'parked' for an active run queued behind the capacity cap", () => {
    expect(
      deriveRunIndicator({
        status: 'running',
        awaitingCapacityStepSlug: 'implement',
      }),
    ).toBe('parked');
  });

  it("surfaces 'failed' for a run that ended in failure", () => {
    expect(deriveRunIndicator({ status: 'failed' })).toBe('failed');
  });

  it('surfaces nothing for a healthy run, a settled run, or no run', () => {
    expect(deriveRunIndicator({ status: 'running' })).toBe(null);
    expect(deriveRunIndicator({ status: 'completed' })).toBe(null);
    expect(deriveRunIndicator({ status: 'cancelled' })).toBe(null);
    expect(deriveRunIndicator(null)).toBe(null);
    expect(deriveRunIndicator(undefined)).toBe(null);
  });

  it("reads a failed run with a stale capacity slug as 'failed', not 'parked'", () => {
    // isParkedOnCapacity already gates on an active status, so the stale slug
    // never wins: the row reads as failed.
    expect(
      deriveRunIndicator({
        status: 'failed',
        awaitingCapacityStepSlug: 'implement',
      }),
    ).toBe('failed');
  });
});
