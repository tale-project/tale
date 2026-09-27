import { describe, expect, it } from 'vitest';

import { isAbortError } from './abort-error';

describe('isAbortError', () => {
  it('recognizes the rejection of an aborted signal', () => {
    const controller = new AbortController();
    controller.abort();
    expect(isAbortError(controller.signal.reason)).toBe(true);
  });

  it('recognizes the DOMException an aborted fetch body rejects with', () => {
    expect(
      isAbortError(
        new DOMException('The user aborted a request.', 'AbortError'),
      ),
    ).toBe(true);
  });

  it('recognizes a plain Error named AbortError', () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    expect(isAbortError(error)).toBe(true);
  });

  it('does not take a timeout for a cancellation', () => {
    expect(
      isAbortError(new DOMException('signal timed out', 'TimeoutError')),
    ).toBe(false);
  });

  it('does not take a transport failure for a cancellation', () => {
    expect(isAbortError(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('rejects values that are not errors', () => {
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});
