import { describe, expect, it } from 'vitest';

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
});
