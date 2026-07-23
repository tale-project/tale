import { describe, expect, it } from 'vitest';

import { formatChildPath, formatOrgPath, parseOrgPath } from './webdav-paths';

/**
 * The path parser is the boundary between text an agent wrote and an
 * organization's files, so these tests are mostly about what it refuses: every
 * spelling of "leave this tree" and every character that would make a name
 * mean something different further down.
 */

describe('accepted paths', () => {
  it('reads the organization root from every spelling of it', () => {
    for (const raw of ['/', '', '   ']) {
      expect(parseOrgPath(raw)).toEqual({ ok: true, segments: [] });
    }
  });

  it('ignores leading and trailing slashes', () => {
    for (const raw of [
      '/reports/q3.md',
      'reports/q3.md',
      '/reports/q3.md/',
      '  /reports/q3.md  ',
    ]) {
      expect(parseOrgPath(raw)).toEqual({
        ok: true,
        segments: ['reports', 'q3.md'],
      });
    }
  });

  it('keeps names that merely look unusual', () => {
    const parsed = parseOrgPath('/Rapports 2026/résumé (v2).md');
    expect(parsed).toEqual({
      ok: true,
      segments: ['Rapports 2026', 'résumé (v2).md'],
    });
  });

  it('normalizes unicode the way the DAV wire boundary does', () => {
    // "café.md" decomposed (e + combining acute), the form macOS clients
    // send — it must land as the composed form every other client sends, or
    // the same file would index twice.
    const decomposed = parseOrgPath('/cafe\u0301.md');
    expect(decomposed).toEqual({ ok: true, segments: ['caf\u00e9.md'] });
  });

  it('does not decode percent escapes, so an escaped traversal stays a name', () => {
    expect(parseOrgPath('/%2e%2e/secrets.md')).toEqual({
      ok: true,
      segments: ['%2e%2e', 'secrets.md'],
    });
  });
});

describe('refused paths', () => {
  const refusals: Array<[string, string, string]> = [
    ['a parent traversal', '/reports/../../etc/passwd', 'traversal'],
    ['a bare traversal', '..', 'traversal'],
    ['a current-directory segment', '/reports/./q3.md', 'traversal'],
    [
      'an authority-style absolute path',
      '//evil.example.com/share',
      'authority',
    ],
    ['a URL', 'https://evil.example.com/x', 'URL'],
    ['a NUL character', '/reports/q3\0.md', 'NUL'],
    ['a newline', '/reports/q3\n.md', 'not a usable name'],
    ['a Windows separator', 'reports\\q3.md', 'not a usable name'],
    ['an empty interior segment', '/reports//q3.md', 'empty segment'],
    [
      'a too-deep path',
      `/${Array.from({ length: 21 }, () => 'x').join('/')}`,
      'deeper',
    ],
    ['an over-long path', `/${'x'.repeat(2000)}`, 'longer than'],
  ];

  it.each(refusals)('refuses %s', (_label, raw, reasonFragment) => {
    const parsed = parseOrgPath(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('expected a refusal');
    expect(parsed.reason).toContain(reasonFragment);
  });

  it('refuses a path that is not a string at all', () => {
    for (const raw of [undefined, null, 42, { path: '/x' }]) {
      expect(parseOrgPath(raw)).toEqual({
        ok: false,
        reason: 'path must be a string',
      });
    }
  });

  it('refuses an org-crossing attempt rather than reinterpreting it', () => {
    // The only way a caller could name another tenant is by climbing out of
    // its own; the organization itself is never an input.
    const parsed = parseOrgPath('/../org-other/documents/secret.md');
    expect(parsed.ok).toBe(false);
  });
});

describe('formatting', () => {
  it('renders the canonical path of a parse', () => {
    expect(formatOrgPath([])).toBe('/');
    expect(formatOrgPath(['reports'])).toBe('/reports');
    expect(formatOrgPath(['reports', 'q3.md'])).toBe('/reports/q3.md');
  });

  it('renders children without doubling the root slash', () => {
    expect(formatChildPath([], 'notes.md')).toBe('/notes.md');
    expect(formatChildPath(['reports'], 'notes.md')).toBe('/reports/notes.md');
  });
});
