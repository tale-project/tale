import { describe, expect, it } from 'vitest';

import { readableErrorMessage } from './error-message';

/** A backend refusal as the platform throws it: `AppError` keeps the
 * payload on `data` and serializes it into `message`, for logs. */
class RefusalError extends Error {
  readonly data: unknown;
  constructor(data: unknown) {
    super(JSON.stringify(data));
    this.data = data;
  }
}

describe('readableErrorMessage', () => {
  it('reads the sentence a plain error carries', () => {
    expect(readableErrorMessage(new Error('Your session has ended.'))).toBe(
      'Your session has ended.',
    );
    expect(readableErrorMessage(new SyntaxError('Unexpected token'))).toBe(
      'Unexpected token',
    );
  });

  it("never reads a structured error's serialized payload", () => {
    const refusal = new RefusalError({
      code: 'UNAUTHORIZED',
      message: 'Your session has ended.',
    });
    expect(refusal.message).toContain('"code"');
    expect(readableErrorMessage(refusal)).toBeUndefined();
    expect(
      readableErrorMessage(Object.assign(new Error('{}'), { data: undefined })),
    ).toBeUndefined();
  });

  it('finds no words in an empty message or a value that is not an error', () => {
    expect(readableErrorMessage(new Error(''))).toBeUndefined();
    expect(readableErrorMessage('boom')).toBeUndefined();
    expect(readableErrorMessage({ message: 'boom' })).toBeUndefined();
    expect(readableErrorMessage(undefined)).toBeUndefined();
  });
});
