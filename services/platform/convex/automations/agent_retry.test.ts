/**
 * Pure-function tests for the agent node's in-node auto-retry gate. The
 * convex-test halves — the re-kick in place, the launch-stamp fences, and
 * the burned-hash threading — live in stepper.test.ts.
 */

import { describe, expect, it } from 'vitest';

import {
  AUTO_RETRY_MAX_ATTEMPTS,
  AUTO_RETRY_PROGRESS_MS,
  executedMsOf,
  isWorkflowAgentRetryable,
  MAX_BURNED_BROKER_HASHES,
  mergeBurnedHashes,
  nextAttempt,
} from './agent_retry';

describe('isWorkflowAgentRetryable', () => {
  it('denies exactly the wasted-window codes', () => {
    expect(isWorkflowAgentRetryable('deadline')).toBe(false);
    expect(isWorkflowAgentRetryable('ask_expired')).toBe(false);
  });

  it('retries every produced failure code by default', () => {
    for (const code of [
      'harness_error',
      'turn_crashed',
      'session_gone',
      'start_failed',
      'harvest_failed',
      'resume_failed',
    ]) {
      expect(isWorkflowAgentRetryable(code)).toBe(true);
    }
  });

  it('an absent or unknown code inherits the retry posture', () => {
    expect(isWorkflowAgentRetryable(undefined)).toBe(true);
    expect(isWorkflowAgentRetryable('some_future_code')).toBe(true);
  });
});

describe('executedMsOf', () => {
  const NOW = 1_700_000_000_000;

  it('a missing launch stamp reads as zero, never as a long run', () => {
    expect(executedMsOf(undefined, NOW)).toBe(0);
  });

  it('measures launch to settle consumption, floored at zero', () => {
    expect(executedMsOf(NOW - 60_000, NOW)).toBe(60_000);
    expect(executedMsOf(NOW + 5_000, NOW)).toBe(0);
  });
});

describe('nextAttempt', () => {
  it('counts short-lived failures toward the budget', () => {
    expect(nextAttempt(0, 0)).toBe(1);
    expect(nextAttempt(1, AUTO_RETRY_PROGRESS_MS - 1)).toBe(2);
    expect(nextAttempt(AUTO_RETRY_MAX_ATTEMPTS, 0)).toBe(
      AUTO_RETRY_MAX_ATTEMPTS + 1,
    );
  });

  it('an attempt that executed past the threshold refreshes the budget', () => {
    expect(nextAttempt(AUTO_RETRY_MAX_ATTEMPTS, AUTO_RETRY_PROGRESS_MS)).toBe(
      1,
    );
  });
});

describe('mergeBurnedHashes', () => {
  it('appends the settled attempt hash, deduped and most recent last', () => {
    expect(mergeBurnedHashes(undefined, 'a')).toEqual(['a']);
    expect(mergeBurnedHashes(['a'], 'b')).toEqual(['a', 'b']);
    expect(mergeBurnedHashes(['a', 'b'], 'a')).toEqual(['b', 'a']);
    expect(mergeBurnedHashes(['a'], undefined)).toEqual(['a']);
  });

  it('drops the oldest entries past the cap', () => {
    const many = Array.from({ length: MAX_BURNED_BROKER_HASHES + 2 }, (_, i) =>
      String(i),
    );
    const merged = mergeBurnedHashes(many, 'z');
    expect(merged).toHaveLength(MAX_BURNED_BROKER_HASHES);
    expect(merged.at(-1)).toBe('z');
    expect(merged[0]).toBe('3');
  });
});
