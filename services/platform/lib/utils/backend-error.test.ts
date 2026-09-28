import { describe, expect, it } from 'vitest';

import { AppError } from '../shared/errors/app-error';
import {
  backendErrorCode,
  backendErrorMessage,
  backendRefusalReason,
  backendUserMessage,
  invalidBodyReason,
} from './backend-error';

describe('backendErrorCode', () => {
  it('extracts a string code from a AppError', () => {
    expect(backendErrorCode(new AppError({ code: 'forbidden' }))).toBe(
      'forbidden',
    );
  });

  it('returns undefined for non-AppError throws', () => {
    expect(backendErrorCode(new Error('boom'))).toBeUndefined();
    expect(backendErrorCode('boom')).toBeUndefined();
    expect(backendErrorCode(undefined)).toBeUndefined();
  });

  it('returns undefined when data lacks a string code', () => {
    expect(
      backendErrorCode(new AppError({ message: 'no code' })),
    ).toBeUndefined();
    expect(backendErrorCode(new AppError({ code: 42 }))).toBeUndefined();
    expect(backendErrorCode(new AppError('plain string data'))).toBeUndefined();
  });
});

describe('backendErrorMessage', () => {
  it('extracts a string message from a AppError', () => {
    expect(
      backendErrorMessage(
        new AppError({ message: 'Key already exists' }),
        'fallback',
      ),
    ).toBe('Key already exists');
  });

  it('returns the fallback for non-AppError throws', () => {
    expect(backendErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
    expect(backendErrorMessage('boom', 'fallback')).toBe('fallback');
    expect(backendErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when data lacks a string message', () => {
    expect(
      backendErrorMessage(new AppError({ code: 'forbidden' }), 'fallback'),
    ).toBe('fallback');
    expect(backendErrorMessage(new AppError({ message: 99 }), 'fallback')).toBe(
      'fallback',
    );
    expect(
      backendErrorMessage(new AppError('plain string data'), 'fallback'),
    ).toBe('fallback');
  });
});

describe('backendUserMessage', () => {
  it('extracts a string userMessage from a AppError', () => {
    expect(
      backendUserMessage(
        new AppError({
          code: 'FORBIDDEN',
          userMessage: 'Only owners can delete organizations.',
        }),
        'fallback',
      ),
    ).toBe('Only owners can delete organizations.');
  });

  it('returns the fallback for non-AppError throws', () => {
    expect(backendUserMessage(new Error('boom'), 'fallback')).toBe('fallback');
    expect(backendUserMessage('boom', 'fallback')).toBe('fallback');
    expect(backendUserMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when data lacks a string userMessage', () => {
    expect(
      backendUserMessage(
        new AppError({ code: 'FORBIDDEN', message: 'internal text' }),
        'fallback',
      ),
    ).toBe('fallback');
    expect(
      backendUserMessage(new AppError({ userMessage: 42 }), 'fallback'),
    ).toBe('fallback');
    expect(
      backendUserMessage(new AppError('plain string data'), 'fallback'),
    ).toBe('fallback');
  });
});

describe('backendRefusalReason', () => {
  it('returns the sentence a coded refusal carries beside its code', () => {
    expect(
      backendRefusalReason(
        new AppError({
          code: 'invalid body',
          message: 'price: Number must be less than or equal to 1000',
        }),
      ),
    ).toBe('price: Number must be less than or equal to 1000');
  });

  it('is undefined when the message only repeats the code', () => {
    expect(
      backendRefusalReason(
        new AppError({
          code: 'PRODUCT_NOT_FOUND',
          message: 'PRODUCT_NOT_FOUND',
        }),
      ),
    ).toBeUndefined();
    expect(backendRefusalReason(new AppError({ code: 'X' }))).toBeUndefined();
  });

  it('is undefined for an unstructured throw', () => {
    expect(backendRefusalReason(new Error('boom'))).toBeUndefined();
    expect(backendRefusalReason(undefined)).toBeUndefined();
  });

  // A lapsed session needs no case of its own: the app's normalization
  // (`toBackendError`) already put the person's sentence where the door's
  // guidance for API clients was, and the reader hands it on. The whole lane
  // — the door's answer, normalized, read — is `app/lib/backend/adapters.test.ts`.
  it("hands on a lapsed session's sentence like any other", () => {
    expect(
      backendRefusalReason(
        new AppError({
          code: 'UNAUTHORIZED',
          message: 'Your session has ended. Sign in again.',
          userMessage: 'Your session has ended. Sign in again.',
        }),
      ),
    ).toBe('Your session has ended. Sign in again.');
  });
});

describe('invalidBodyReason', () => {
  it("returns a refused body's field-naming sentence", () => {
    expect(
      invalidBodyReason(
        new AppError({
          code: 'invalid body',
          message: 'name: Too big: expected string to have <=300 characters',
          issues: [{ path: 'name', message: 'Too big' }],
        }),
      ),
    ).toBe('name: Too big: expected string to have <=300 characters');
  });

  it('is undefined when the refusal carries only the code', () => {
    expect(
      invalidBodyReason(
        new AppError({ code: 'invalid body', message: 'invalid body' }),
      ),
    ).toBeUndefined();
  });

  it("is undefined for another code's message, which is no display contract", () => {
    expect(
      invalidBodyReason(
        new AppError({ code: 'FORBIDDEN', message: 'internal text' }),
      ),
    ).toBeUndefined();
    expect(invalidBodyReason(new Error('boom'))).toBeUndefined();
  });
});
