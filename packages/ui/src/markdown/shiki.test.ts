import { describe, expect, it } from 'vitest';

import { highlightCode, resolveShikiTheme } from './shiki';

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
