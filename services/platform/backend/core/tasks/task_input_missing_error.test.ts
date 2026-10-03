import { describe, expect, it } from 'vitest';

import {
  describeMissingTaskInputs,
  isTaskInputMissingError,
  TaskInputMissingError,
} from './task_input_missing_error';

describe('TaskInputMissingError', () => {
  it('names the one gone attachment and the move that helps', () => {
    const error = new TaskInputMissingError(['Afos.xlsx']);
    expect(error.message).toBe(
      'the attachment "Afos.xlsx" is no longer in storage — remove it from the task or upload it again',
    );
    expect(error.fileNames).toEqual(['Afos.xlsx']);
    expect(isTaskInputMissingError(error)).toBe(true);
    // The same words on a plain Error are not the fact; the class is.
    expect(isTaskInputMissingError(new Error(error.message))).toBe(false);
  });

  it('lists several gone attachments in one sentence', () => {
    expect(describeMissingTaskInputs(['a.pdf', 'b.pdf'])).toBe(
      'the attachments "a.pdf" and "b.pdf" are no longer in storage — remove them from the task or upload them again',
    );
    expect(
      describeMissingTaskInputs(['Afos.xlsx', 'ks.xlsx', 'Nfas.xlsx']),
    ).toBe(
      'the attachments "Afos.xlsx", "ks.xlsx" and "Nfas.xlsx" are no longer in storage — remove them from the task or upload them again',
    );
  });
});
