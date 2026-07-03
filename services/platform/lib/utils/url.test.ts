import { describe, expect, it } from 'vitest';

import { isHttpUrl } from './url';

describe('isHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isHttpUrl('https://example.com/mcp')).toBe(true);
    expect(isHttpUrl('http://localhost:3000')).toBe(true);
  });

  it('rejects empty and whitespace strings', () => {
    expect(isHttpUrl('')).toBe(false);
    expect(isHttpUrl('   ')).toBe(false);
  });

  it('rejects scheme-less values', () => {
    expect(isHttpUrl('not-a-url')).toBe(false);
    expect(isHttpUrl('example.com')).toBe(false);
    expect(isHttpUrl('://broken')).toBe(false);
  });

  it('rejects non-http(s) protocols', () => {
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
  });
});
