import { describe, expect, it } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import { SkillUnavailableError } from '../skills/skill_unavailable_error';
import { classifyStartFailure } from './start_failure';
import { isAutoRetryableFailure } from './task_auto_retry';

describe('classifyStartFailure', () => {
  it('settles a skill the run cannot reach as equipment_missing, named, and not retried', () => {
    const settled = classifyStartFailure(new SkillUnavailableError('docx'));
    expect(settled.failureCode).toBe('equipment_missing');
    expect(settled.reason).toBe(
      'the agent run could not start: the skill "docx" is not available to this run — it does not exist or is not shared with the run\'s scope',
    );
    expect(isAutoRetryableFailure(settled.failureCode)).toBe(false);
  });

  it('keeps every other start error a retried start_failed with its own words', () => {
    const settled = classifyStartFailure(new Error('spawner unreachable'));
    expect(settled).toEqual({
      reason: 'the agent run could not start: spawner unreachable',
      failureCode: 'start_failed',
    });
    expect(isAutoRetryableFailure(settled.failureCode)).toBe(true);
  });

  it('names when a broker pool that is cooling down has an account back, for the retry to wait', () => {
    const retryAtMs = Date.UTC(2026, 8, 28, 12, 1, 0);
    const settled = classifyStartFailure(
      new AppError({
        code: 'CREDENTIAL_BROKER_EXHAUSTED',
        message:
          'Every account behind credential "Team pool" is cooling down after a rate limit — try again in 42 seconds.',
        retryAtMs,
      }),
    );
    expect(settled).toEqual({
      reason:
        'the agent run could not start: Every account behind credential "Team pool" is cooling down after a rate limit — try again in 42 seconds.',
      failureCode: 'start_failed',
      retryAtMs,
    });
    expect(isAutoRetryableFailure(settled.failureCode)).toBe(true);
  });

  it('words a credential refusal in its own sentence, never its payload', () => {
    const settled = classifyStartFailure(
      new AppError({
        code: 'CREDENTIAL_DISABLED',
        message: 'Credential "Primary" is disabled — enable it.',
      }),
    );
    expect(settled).toEqual({
      reason:
        'the agent run could not start: Credential "Primary" is disabled — enable it.',
      failureCode: 'start_failed',
    });
  });
});
