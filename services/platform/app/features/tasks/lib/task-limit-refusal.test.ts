import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import { taskLimitRefusalMessage } from './task-limit-refusal';

const t = (key: string, values?: Record<string, unknown>) =>
  `tasks.${key} ${JSON.stringify(values ?? {})}`;
// The caller's locale-bound formatter, marked so the test sees it applied.
const grouped = (value: number) => `#${value}`;

describe('taskLimitRefusalMessage', () => {
  it('names the description cap in the reader’s number format', () => {
    expect(
      taskLimitRefusalMessage(
        new AppError({ code: 'TASK_DESCRIPTION_INVALID' }),
        t,
        grouped,
      ),
    ).toBe('tasks.errors.TASK_DESCRIPTION_INVALID {"max":"#20000"}');
  });

  it('names the title cap for an empty or over-long title alike', () => {
    expect(
      taskLimitRefusalMessage(
        new AppError({ code: 'TASK_TITLE_INVALID' }),
        t,
        grouped,
      ),
    ).toBe('tasks.errors.TASK_TITLE_INVALID {"max":"#200"}');
  });

  it('leaves every other failure to the caller', () => {
    expect(
      taskLimitRefusalMessage(
        new AppError({ code: 'TASK_LABELS_INVALID' }),
        t,
        grouped,
      ),
    ).toBeUndefined();
    expect(
      taskLimitRefusalMessage(new Error('offline'), t, grouped),
    ).toBeUndefined();
  });
});
