import { describe, expect, it } from 'vitest';

import { highlightCode, resolveLanguage, resolveShikiTheme } from './shiki';

describe('resolveShikiTheme', () => {
  it('maps light aliases onto min-light', () => {
    expect(resolveShikiTheme('light')).toBe('min-light');
    expect(resolveShikiTheme('github-light')).toBe('min-light');
    expect(resolveShikiTheme('min-light')).toBe('min-light');
  });

  it('maps dark aliases onto min-dark', () => {
    expect(resolveShikiTheme('dark')).toBe('min-dark');
    expect(resolveShikiTheme('github-dark')).toBe('min-dark');
    expect(resolveShikiTheme('min-dark')).toBe('min-dark');
  });
});

describe('highlightCode themes', () => {
  it('emits min-* theme classes for github-* aliases (#2785)', async () => {
    const dark = await highlightCode('const x = 1;', 'ts', 'github-dark');
    expect(dark?.html).toContain('class="shiki min-dark"');

    const light = await highlightCode('{"a":1}', 'json', 'github-light');
    expect(light?.html).toContain('class="shiki min-light"');
  });
});

describe('diff highlighting', () => {
  it('resolves .patch onto the diff grammar', () => {
    expect(resolveLanguage('patch')).toBe('diff');
    expect(resolveLanguage('diff')).toBe('diff');
  });

  // REGRESSION: the min-* themes ship no colors for the diff scopes, so a
  // previewed .patch file rendered fully monochrome. The extended themes must
  // give added and removed lines distinct colors.
  it('colors added and removed lines distinctly', async () => {
    const result = await highlightCode(
      '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n',
      'patch',
      'light',
    );
    expect(result?.language).toBe('diff');
    expect(result?.html).toContain('#22863A');
    expect(result?.html).toContain('#B31D28');

    const dark = await highlightCode('-old\n+new\n', 'diff', 'dark');
    expect(dark?.html).toContain('#85E89D');
    expect(dark?.html).toContain('#F97583');
  });
});
