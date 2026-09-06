import { describe, expect, test } from 'bun:test';

import { describeRunFailure } from './daemon';

describe('describeRunFailure', () => {
  test('a spawn failure is reported as non-retryable', () => {
    // ENOENT (adapter binary missing) or E2BIG (prompt overflowed argv): the
    // run never started here and will not start on a re-dispatch either.
    const failure = describeRunFailure({
      stdout: '',
      code: -1,
      spawnError: 'spawn claude ENOENT',
    });
    expect(failure).toEqual({
      message: 'CLI could not be started: spawn claude ENOENT',
      retryable: false,
    });
  });

  test('a non-zero exit stays retryable and carries the output tail', () => {
    const failure = describeRunFailure({ stdout: 'boom', code: 2 });
    expect(failure).toEqual({
      message: 'CLI exited with code 2: boom',
      retryable: true,
    });
  });

  test('a clean exit is not a failure', () => {
    expect(describeRunFailure({ stdout: 'ok', code: 0 })).toBeNull();
  });
});
