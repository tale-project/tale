import { describe, expect, it } from 'vitest';

import { describeError, errorText, firstLine } from './error-text.ts';

describe('errorText', () => {
  it('is the message of an error', () => {
    expect(errorText(new TypeError('x is not a function'))).toBe(
      'x is not a function',
    );
  });

  it('is the text of anything else that was thrown', () => {
    expect(errorText('plain words')).toBe('plain words');
    expect(errorText(404)).toBe('404');
    expect(errorText(null)).toBe('null');
  });
});

describe('describeError', () => {
  it('names the kind of error before its message', () => {
    expect(describeError(new RangeError('too big'))).toBe(
      'RangeError: too big',
    );
  });

  it('is the text of anything else that was thrown', () => {
    expect(describeError('plain words')).toBe('plain words');
  });
});

describe('firstLine', () => {
  it('drops the call log Playwright appends after the first line', () => {
    const error = new Error(
      'locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting',
    );
    expect(firstLine(error)).toBe('locator.click: Timeout 30000ms exceeded.');
  });

  it.each(['\r\n', '\r', '\n', '\v', '\f', '\u0085', '\u2028', '\u2029'])(
    'ends the line at the line break %j',
    (lineBreak) => {
      expect(firstLine(new Error(`first${lineBreak}second`))).toBe('first');
    },
  );

  it('says the name of an error that has no message', () => {
    expect(firstLine(new TypeError(''))).toBe('TypeError');
    expect(firstLine(new RangeError('  \n '))).toBe('RangeError');
    expect(firstLine('')).toBe('Error');
  });

  it('is the text of anything else that was thrown', () => {
    expect(firstLine('plain\nwords')).toBe('plain');
  });

  it('cuts a long line at 300 characters, not in the middle of an emoji', () => {
    const line = firstLine(new Error('😀'.repeat(400)));
    expect(Array.from(line)).toHaveLength(300);
    expect(line).toBe('😀'.repeat(300));
  });
});
