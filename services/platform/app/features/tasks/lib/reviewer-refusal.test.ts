import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import {
  reviewerBlockedMessage,
  reviewerRefusalMessage,
} from './reviewer-refusal';

const t = (key: string) => `tasks.${key}`;

describe('reviewerRefusalMessage', () => {
  it.each([
    ['reviewer_unavailable', 'agentUnavailable'],
    ['permission_missing', 'agentPermissionRequired'],
    ['source_required', 'sourceRequired'],
    ['source_changed', 'sourceChanged'],
    ['self_review', 'notIndependent'],
    ['human_policy', 'humanPolicy'],
    ['policy_unavailable', 'policyUnavailable'],
  ] as const)('explains the server diagnosis %s', (reason, key) => {
    expect(reviewerBlockedMessage(reason, t)).toBe(`tasks.reviewer.${key}`);
  });
  it('explains a designee who cannot edit the project with the picker hint', () => {
    expect(
      reviewerRefusalMessage(
        new AppError({ code: 'TASK_REVIEWER_NO_EDIT_ACCESS' }),
        t,
      ),
    ).toBe('tasks.reviewer.editorsOnly');
  });

  it('explains a designee who is no longer eligible', () => {
    expect(
      reviewerRefusalMessage(
        new AppError({ code: 'TASK_REVIEWER_INVALID' }),
        t,
      ),
    ).toBe('tasks.reviewer.invalid');
  });

  it('leaves every other failure to the caller', () => {
    expect(
      reviewerRefusalMessage(new AppError({ code: 'TASK_NOT_FOUND' }), t),
    ).toBeUndefined();
    expect(reviewerRefusalMessage(new Error('offline'), t)).toBeUndefined();
  });
});
