import { describe, expect, it } from 'vitest';

import { isAutoRetryableFailure } from './task_auto_retry';

describe('isAutoRetryableFailure', () => {
  it('retries faults by default, an absent code included', () => {
    for (const code of [
      undefined,
      'harness_error',
      'turn_crashed',
      'session_gone',
      'start_failed',
      'harvest_failed',
      'empty_turn',
      'something_new',
    ]) {
      expect(isAutoRetryableFailure(code), String(code)).toBe(true);
    }
  });

  it('never retries what a retry cannot change — a burned window, a gone agent, a missing skill, a cap', () => {
    // A skill the run cannot reach is the agent's configuration: the retry
    // budget used to burn three runs on it before the author could act
    // (2026-09-26 evaluation, C-09).
    for (const code of [
      'deadline',
      'park_deadline',
      'agent_deleted',
      'agent_model_missing',
      'equipment_missing',
      'budget_exceeded',
    ]) {
      expect(isAutoRetryableFailure(code), code).toBe(false);
    }
  });
});
