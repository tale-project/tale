import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import {
  backendErrorCode,
  backendErrorMessage,
  backendUserMessage,
} from './backend-error';

describe('backendErrorCode', () => {
  it('extracts a string code from a ConvexError', () => {
    expect(backendErrorCode(new ConvexError({ code: 'forbidden' }))).toBe(
      'forbidden',
    );
  });

  it('returns undefined for non-ConvexError throws', () => {
    expect(backendErrorCode(new Error('boom'))).toBeUndefined();
    expect(backendErrorCode('boom')).toBeUndefined();
    expect(backendErrorCode(undefined)).toBeUndefined();
  });

  it('returns undefined when data lacks a string code', () => {
    expect(
      backendErrorCode(new ConvexError({ message: 'no code' })),
    ).toBeUndefined();
    expect(backendErrorCode(new ConvexError({ code: 42 }))).toBeUndefined();
    expect(
      backendErrorCode(new ConvexError('plain string data')),
    ).toBeUndefined();
  });
});

describe('backendErrorMessage', () => {
  it('extracts a string message from a ConvexError', () => {
    expect(
      backendErrorMessage(
        new ConvexError({ message: 'Key already exists' }),
        'fallback',
      ),
    ).toBe('Key already exists');
  });

  it('returns the fallback for non-ConvexError throws', () => {
    expect(backendErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
    expect(backendErrorMessage('boom', 'fallback')).toBe('fallback');
    expect(backendErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when data lacks a string message', () => {
    expect(
      backendErrorMessage(new ConvexError({ code: 'forbidden' }), 'fallback'),
    ).toBe('fallback');
    expect(
      backendErrorMessage(new ConvexError({ message: 99 }), 'fallback'),
    ).toBe('fallback');
    expect(
      backendErrorMessage(new ConvexError('plain string data'), 'fallback'),
    ).toBe('fallback');
  });
});

describe('backendUserMessage', () => {
  it('extracts a string userMessage from a ConvexError', () => {
    expect(
      backendUserMessage(
        new ConvexError({
          code: 'FORBIDDEN',
          userMessage: 'Only owners can delete organizations.',
        }),
        'fallback',
      ),
    ).toBe('Only owners can delete organizations.');
  });

  it('returns the fallback for non-ConvexError throws', () => {
    expect(backendUserMessage(new Error('boom'), 'fallback')).toBe('fallback');
    expect(backendUserMessage('boom', 'fallback')).toBe('fallback');
    expect(backendUserMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when data lacks a string userMessage', () => {
    expect(
      backendUserMessage(
        new ConvexError({ code: 'FORBIDDEN', message: 'internal text' }),
        'fallback',
      ),
    ).toBe('fallback');
    expect(
      backendUserMessage(new ConvexError({ userMessage: 42 }), 'fallback'),
    ).toBe('fallback');
    expect(
      backendUserMessage(new ConvexError('plain string data'), 'fallback'),
    ).toBe('fallback');
  });
});
