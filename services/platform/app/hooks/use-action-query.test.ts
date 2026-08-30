import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import { backendErrorCode, isStructuredBackendError } from './use-action-query';

describe('isStructuredBackendError', () => {
  it('is true for a AppError carrying object data', () => {
    expect(isStructuredBackendError(new AppError({ code: 'X' }))).toBe(true);
  });

  it('is false for a plain Error and non-error values', () => {
    expect(isStructuredBackendError(new Error('boom'))).toBe(false);
    expect(isStructuredBackendError('boom')).toBe(false);
    expect(isStructuredBackendError(null)).toBe(false);
    // A AppError with a string payload has no structured `data` object.
    expect(isStructuredBackendError(new AppError('boom'))).toBe(false);
  });
});

describe('backendErrorCode', () => {
  it('returns the code from a structured AppError', () => {
    expect(
      backendErrorCode(new AppError({ code: 'CONNECTOR_NOT_CONNECTED' })),
    ).toBe('CONNECTOR_NOT_CONNECTED');
  });

  it('returns undefined when there is no string code', () => {
    expect(backendErrorCode(new AppError({ message: 'no code' }))).toBe(
      undefined,
    );
    expect(backendErrorCode(new AppError({ code: 42 }))).toBe(undefined);
  });

  it('returns undefined for a plain Error or non-error value', () => {
    expect(backendErrorCode(new Error('boom'))).toBe(undefined);
    expect(backendErrorCode(undefined)).toBe(undefined);
    expect(backendErrorCode({ data: null })).toBe(undefined);
  });
});
