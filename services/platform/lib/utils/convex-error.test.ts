import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import {
  convexErrorCode,
  convexErrorMessage,
  convexUserMessage,
} from './convex-error';

describe('convexErrorCode', () => {
  it('extracts a string code from a ConvexError', () => {
    expect(convexErrorCode(new ConvexError({ code: 'forbidden' }))).toBe(
      'forbidden',
    );
  });

  it('returns undefined for non-ConvexError throws', () => {
    expect(convexErrorCode(new Error('boom'))).toBeUndefined();
    expect(convexErrorCode('boom')).toBeUndefined();
    expect(convexErrorCode(undefined)).toBeUndefined();
  });

  it('returns undefined when data lacks a string code', () => {
    expect(
      convexErrorCode(new ConvexError({ message: 'no code' })),
    ).toBeUndefined();
    expect(convexErrorCode(new ConvexError({ code: 42 }))).toBeUndefined();
    expect(
      convexErrorCode(new ConvexError('plain string data')),
    ).toBeUndefined();
  });
});

describe('convexErrorMessage', () => {
  it('extracts a string message from a ConvexError', () => {
    expect(
      convexErrorMessage(
        new ConvexError({ message: 'Key already exists' }),
        'fallback',
      ),
    ).toBe('Key already exists');
  });

  it('returns the fallback for non-ConvexError throws', () => {
    expect(convexErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
    expect(convexErrorMessage('boom', 'fallback')).toBe('fallback');
    expect(convexErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when data lacks a string message', () => {
    expect(
      convexErrorMessage(new ConvexError({ code: 'forbidden' }), 'fallback'),
    ).toBe('fallback');
    expect(
      convexErrorMessage(new ConvexError({ message: 99 }), 'fallback'),
    ).toBe('fallback');
    expect(
      convexErrorMessage(new ConvexError('plain string data'), 'fallback'),
    ).toBe('fallback');
  });
});

describe('convexUserMessage', () => {
  it('extracts a string userMessage from a ConvexError', () => {
    expect(
      convexUserMessage(
        new ConvexError({
          code: 'FORBIDDEN',
          userMessage: 'Only owners can delete organizations.',
        }),
        'fallback',
      ),
    ).toBe('Only owners can delete organizations.');
  });

  it('returns the fallback for non-ConvexError throws', () => {
    expect(convexUserMessage(new Error('boom'), 'fallback')).toBe('fallback');
    expect(convexUserMessage('boom', 'fallback')).toBe('fallback');
    expect(convexUserMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when data lacks a string userMessage', () => {
    expect(
      convexUserMessage(
        new ConvexError({ code: 'FORBIDDEN', message: 'internal text' }),
        'fallback',
      ),
    ).toBe('fallback');
    expect(
      convexUserMessage(new ConvexError({ userMessage: 42 }), 'fallback'),
    ).toBe('fallback');
    expect(
      convexUserMessage(new ConvexError('plain string data'), 'fallback'),
    ).toBe('fallback');
  });
});
