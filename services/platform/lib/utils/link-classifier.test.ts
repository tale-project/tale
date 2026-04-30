import { afterEach, describe, expect, it, vi } from 'vitest';

import { classifyLink } from './link-classifier';

describe('classifyLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null for empty/undefined input', () => {
    expect(classifyLink(undefined)).toBeNull();
    expect(classifyLink('')).toBeNull();
    expect(classifyLink('   ')).toBeNull();
  });

  it('classifies hash as hash', () => {
    expect(classifyLink('#section')).toEqual({
      kind: 'hash',
      href: '#section',
    });
  });

  it('classifies mailto/tel/sms as special', () => {
    expect(classifyLink('mailto:foo@example.com')).toEqual({
      kind: 'special',
      href: 'mailto:foo@example.com',
    });
    expect(classifyLink('tel:+15555550123')).toEqual({
      kind: 'special',
      href: 'tel:+15555550123',
    });
  });

  describe('path-only links', () => {
    it('classifies SPA paths as internal', () => {
      expect(classifyLink('/dashboard/foo')).toEqual({
        kind: 'internal',
        to: '/dashboard/foo',
      });
    });

    it('classifies backend prefixes as external', () => {
      expect(classifyLink('/http_api/storage?id=x&filename=y.docx')).toEqual({
        kind: 'external',
        href: '/http_api/storage?id=x&filename=y.docx',
      });
      expect(classifyLink('/api/storage/abc123')).toEqual({
        kind: 'external',
        href: '/api/storage/abc123',
      });
      expect(classifyLink('/ws_api/sync')).toEqual({
        kind: 'external',
        href: '/ws_api/sync',
      });
      expect(classifyLink('/metrics/platform')).toEqual({
        kind: 'external',
        href: '/metrics/platform',
      });
    });

    it('treats a bare backend prefix (no trailing slash) as external', () => {
      expect(classifyLink('/api')).toEqual({
        kind: 'external',
        href: '/api',
      });
    });

    it('does not match paths that merely start with prefix-like text', () => {
      // `/apirelated` is a hypothetical SPA route; it is not under `/api/`.
      expect(classifyLink('/apirelated/foo')).toEqual({
        kind: 'internal',
        to: '/apirelated/foo',
      });
    });

    it('protocol-relative // is not classified as path-internal', () => {
      // Without a window, falls through to the external branch.
      expect(classifyLink('//other.example.com/x')).toEqual({
        kind: 'external',
        href: '//other.example.com/x',
      });
    });
  });

  describe('absolute URLs (with window)', () => {
    function stubWindow(href: string) {
      vi.stubGlobal('window', {
        location: { href, origin: new URL(href).origin },
      });
    }

    it('classifies same-origin SPA path as internal', () => {
      stubWindow('http://localhost:3000/dashboard');
      expect(
        classifyLink('http://localhost:3000/dashboard/foo?x=1#hash'),
      ).toEqual({
        kind: 'internal',
        to: '/dashboard/foo?x=1#hash',
      });
    });

    it('classifies same-origin backend path as external', () => {
      stubWindow('http://localhost:3000/dashboard');
      expect(
        classifyLink(
          'http://localhost:3000/http_api/storage?id=x&filename=y.docx',
        ),
      ).toEqual({
        kind: 'external',
        href: 'http://localhost:3000/http_api/storage?id=x&filename=y.docx',
      });
    });

    it('classifies cross-origin URL as external', () => {
      stubWindow('http://localhost:3000/dashboard');
      expect(classifyLink('https://example.com/page')).toEqual({
        kind: 'external',
        href: 'https://example.com/page',
      });
    });
  });

  describe('absolute URLs without window', () => {
    it('falls back to external', () => {
      // No window stubbed — the global from happy-dom/jsdom might still exist
      // in some envs. Skip if window is defined to keep this assertion crisp.
      if (typeof window !== 'undefined') return;
      expect(classifyLink('https://example.com/page')).toEqual({
        kind: 'external',
        href: 'https://example.com/page',
      });
    });
  });
});
