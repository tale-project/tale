/**
 * Property-style tests for `pageAsMarkdown`. We assert invariants that
 * must hold for every input: link absolutisation, no trailing-newline
 * drift, and that absolute / mailto links are never rewritten.
 */

import { describe, expect, it } from 'vitest';

import { pageAsMarkdown } from './page-as-markdown';

function rngFromSeed(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomPath(rand: () => number): string {
  const words = ['cloud', 'platform', 'docs', 'pricing', 'imprint', 'team'];
  const parts: number = 1 + Math.floor(rand() * 3);
  const segs: string[] = [];
  for (let i = 0; i < parts; i++)
    segs.push(words[Math.floor(rand() * words.length)]);
  return '/' + segs.join('/');
}

describe('pageAsMarkdown — properties', () => {
  it('output always ends with exactly one trailing newline', () => {
    const samples = [
      '',
      'just text',
      'text\n',
      'text\n\n\n',
      '# Heading\n\nText\n',
    ];
    for (const body of samples) {
      const md = pageAsMarkdown({
        frontmatter: { title: 'X' },
        body,
        siteUrl: 'https://tale.dev',
      });
      expect(md.endsWith('\n')).toBe(true);
      // No multiple trailing newlines.
      expect(md.endsWith('\n\n')).toBe(false);
    }
  });

  it('absolutises every relative link, leaves absolute and mailto links alone', () => {
    const body =
      '[a](/foo) [b](/bar/baz) [c](https://example.com/x) [d](mailto:hi@tale.dev)';
    const md = pageAsMarkdown({
      frontmatter: null,
      body,
      siteUrl: 'https://tale.dev',
    });
    expect(md).toContain('[a](https://tale.dev/foo)');
    expect(md).toContain('[b](https://tale.dev/bar/baz)');
    expect(md).toContain('[c](https://example.com/x)');
    expect(md).toContain('[d](mailto:hi@tale.dev)');
  });

  it('emits frontmatter only when provided', () => {
    const a = pageAsMarkdown({
      frontmatter: { title: 'X' },
      body: 'hello',
      siteUrl: 'https://tale.dev',
    });
    expect(a.startsWith('---\n')).toBe(true);

    const b = pageAsMarkdown({
      frontmatter: null,
      body: 'hello',
      siteUrl: 'https://tale.dev',
    });
    expect(b.startsWith('---')).toBe(false);
  });

  it('escapes embedded double-quotes in frontmatter values', () => {
    const md = pageAsMarkdown({
      frontmatter: { title: 'He said "hi"' },
      body: 'x',
      siteUrl: 'https://tale.dev',
    });
    expect(md).toContain('title: "He said \\"hi\\""');
  });

  it('survives random body content without changing absolute links', () => {
    const rand = rngFromSeed(0xface);
    for (let i = 0; i < 50; i++) {
      const path = randomPath(rand);
      const body = `Visit [link](${path}) and [external](https://example.com${path}).`;
      const md = pageAsMarkdown({
        frontmatter: null,
        body,
        siteUrl: 'https://tale.dev',
      });
      expect(md).toContain(`https://tale.dev${path}`);
      expect(md).toContain(`https://example.com${path}`);
    }
  });
});
