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

/** An error a surface or a library defines for display. */
class SaveRefusedError extends Error {}

describe('readableErrorMessage', () => {
  it('reads the sentence a plain error carries', () => {
    expect(readableErrorMessage(new Error('Your session has ended.'))).toBe(
      'Your session has ended.',
    );
    expect(
      readableErrorMessage(new SaveRefusedError('That name is taken.')),
    ).toBe('That name is taken.');
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

  // The platform's `failureDetail` hides these too: their words are the
  // runtime's, in English, for whoever debugs the code. A request that got
  // no answer is one of them here; only the platform words it.
  it("never reads a runtime error's own message", () => {
    for (const fault of [
      new TypeError('Failed to fetch'),
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      new SyntaxError('Unexpected token'),
      new RangeError('Invalid time value'),
      new ReferenceError('x is not defined'),
      new EvalError('eval is not allowed'),
      new URIError('URI malformed'),
    ]) {
      expect(readableErrorMessage(fault)).toBeUndefined();
    }
  });

  it('finds no words in an empty message or a value that is not an error', () => {
    expect(readableErrorMessage(new Error(''))).toBeUndefined();
    expect(readableErrorMessage('boom')).toBeUndefined();
    expect(readableErrorMessage({ message: 'boom' })).toBeUndefined();
    expect(readableErrorMessage(undefined)).toBeUndefined();
  });
});
