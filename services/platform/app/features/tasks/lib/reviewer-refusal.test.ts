import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import { reviewerRefusalMessage } from './reviewer-refusal';

const t = (key: string) => `tasks.${key}`;

describe('reviewerRefusalMessage', () => {
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
