import { describe, expect, it } from 'vitest';

import { BackendError } from '@/app/lib/backend/backend-error';

import { backendErrorCode, isStructuredBackendError } from './use-action-query';

describe('isStructuredBackendError', () => {
  it('is true for a BackendError carrying object data', () => {
    expect(isStructuredBackendError(new BackendError({ code: 'X' }))).toBe(
      true,
    );
  });

  it('is false for a plain Error and non-error values', () => {
    expect(isStructuredBackendError(new Error('boom'))).toBe(false);
    expect(isStructuredBackendError('boom')).toBe(false);
    expect(isStructuredBackendError(null)).toBe(false);
    // A BackendError with a string payload has no structured `data` object.
    expect(isStructuredBackendError(new BackendError('boom'))).toBe(false);
  });
});

describe('backendErrorCode', () => {
  it('returns the code from a structured BackendError', () => {
    expect(
      backendErrorCode(new BackendError({ code: 'CONNECTOR_NOT_CONNECTED' })),
    ).toBe('CONNECTOR_NOT_CONNECTED');
  });

  it('returns undefined when there is no string code', () => {
    expect(backendErrorCode(new BackendError({ message: 'no code' }))).toBe(
      undefined,
    );
    expect(backendErrorCode(new BackendError({ code: 42 }))).toBe(undefined);
  });

  it('returns undefined for a plain Error or non-error value', () => {
    expect(backendErrorCode(new Error('boom'))).toBe(undefined);
    expect(backendErrorCode(undefined)).toBe(undefined);
    expect(backendErrorCode({ data: null })).toBe(undefined);
  });
});
