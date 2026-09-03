// @vitest-environment node

import { describe, expect, test } from 'vitest';

import { isVideoJobRetryable } from './service.ts';

/**
 * The retry door's truth table (the un-retryable dead-end regression): a
 * whisper handoff whose transcription settled failed/skipped is exactly as
 * retryable as a terminal job — the chip already offers Retry for that
 * shape — while every live state stays refused (a retry there would
 * double-run the pipeline).
 */
describe('isVideoJobRetryable', () => {
  test('terminal failed/skipped jobs retry regardless of the file lane', () => {
    expect(isVideoJobRetryable('failed', null)).toBe(true);
    expect(isVideoJobRetryable('skipped', null)).toBe(true);
    expect(isVideoJobRetryable('failed', 'completed')).toBe(true);
  });

  test('a handoff over a settled-failed/skipped file row opens the door', () => {
    expect(isVideoJobRetryable('transcribing_handoff', 'failed')).toBe(true);
    expect(isVideoJobRetryable('transcribing_handoff', 'skipped')).toBe(true);
  });

  test('a live handoff stays non-retryable', () => {
    expect(isVideoJobRetryable('transcribing_handoff', 'queued')).toBe(false);
    expect(isVideoJobRetryable('transcribing_handoff', 'running')).toBe(false);
    expect(isVideoJobRetryable('transcribing_handoff', null)).toBe(false);
  });

  test('a settled-completed handoff and other in-flight states stay closed', () => {
    expect(isVideoJobRetryable('transcribing_handoff', 'completed')).toBe(
      false,
    );
    expect(isVideoJobRetryable('completed', null)).toBe(false);
    expect(isVideoJobRetryable('queued', null)).toBe(false);
    expect(isVideoJobRetryable('fetching_metadata', null)).toBe(false);
    expect(isVideoJobRetryable('indexing', 'failed')).toBe(false);
  });
});
