import { describe, expect, it } from 'vitest';

import { AppError } from '../shared/errors/app-error';
import {
  backendErrorCode,
  backendErrorMessage,
  backendUserMessage,
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
