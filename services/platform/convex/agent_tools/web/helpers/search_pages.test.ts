import { describe, expect, it } from 'vitest';

import { isValidDomain } from './search_pages';

describe('isValidDomain', () => {
  it('accepts a simple domain', () => {
    expect(isValidDomain('example.com')).toBe(true);
  });

  it('accepts a subdomain', () => {
    expect(isValidDomain('docs.convex.dev')).toBe(true);
  });

  it('accepts a domain with port', () => {
    expect(isValidDomain('localhost:8080')).toBe(true);
  });

  it('accepts a deeply nested subdomain', () => {
    expect(isValidDomain('a.b.c.example.com')).toBe(true);
  });

  it('accepts a domain with hyphens', () => {
    expect(isValidDomain('my-site.example.com')).toBe(true);
  });

  it('rejects a domain with protocol', () => {
    expect(isValidDomain('https://example.com')).toBe(false);
  });

  it('rejects a domain with path', () => {
    expect(isValidDomain('example.com/page')).toBe(false);
  });

  it('rejects a domain with spaces', () => {
    expect(isValidDomain('example .com')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidDomain('')).toBe(false);
  });

  it('rejects path traversal attempts', () => {
    expect(isValidDomain('../../admin')).toBe(false);
  });

  it('rejects a domain with query parameters', () => {
    expect(isValidDomain('example.com?q=test')).toBe(false);
  });
});
