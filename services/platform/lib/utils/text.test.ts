import { describe, expect, it } from 'vitest';

import { stripLeadingPunctuation } from './text';

describe('stripLeadingPunctuation', () => {
  it('strips leading colon and space', () => {
    expect(stripLeadingPunctuation(': hello')).toBe('hello');
  });

  it('strips leading full-width colon', () => {
    expect(stripLeadingPunctuation('：hello')).toBe('hello');
  });

  it('strips multiple leading punctuation characters', () => {
    expect(stripLeadingPunctuation(':：; hello')).toBe('hello');
  });

  it('strips leading dashes', () => {
    expect(stripLeadingPunctuation('— hello')).toBe('hello');
  });

  it('strips leading dots and commas', () => {
    expect(stripLeadingPunctuation('., hello')).toBe('hello');
  });

  it('strips leading whitespace', () => {
    expect(stripLeadingPunctuation('  hello')).toBe('hello');
  });

  it('preserves text without leading punctuation', () => {
    expect(stripLeadingPunctuation('hello world')).toBe('hello world');
  });

  it('preserves punctuation in the middle', () => {
    expect(stripLeadingPunctuation('hello: world')).toBe('hello: world');
  });

  it('handles empty string', () => {
    expect(stripLeadingPunctuation('')).toBe('');
  });

  it('handles string that is all punctuation', () => {
    expect(stripLeadingPunctuation(':：;')).toBe('');
  });

  it('preserves numbered list content', () => {
    const input = '请提供以下信息：\n1. 名称：\n2. 地址：';
    expect(stripLeadingPunctuation(input)).toBe(input);
  });
});
