import { describe, expect, it } from 'vitest';

import { pageAsMarkdown } from './page-as-markdown';

describe('pageAsMarkdown', () => {
  it('emits frontmatter and trims trailing whitespace', () => {
    const out = pageAsMarkdown({
      frontmatter: { title: 'Hello', published: true },
      body: '# Hello\n\nWorld.\n\n\n',
      siteUrl: 'https://tale.dev',
    });

    expect(out).toBe(
      '---\ntitle: "Hello"\npublished: true\n---\n# Hello\n\nWorld.\n',
    );
  });

  it('escapes double quotes in frontmatter values', () => {
    const out = pageAsMarkdown({
      frontmatter: { title: 'She said "hi"' },
      body: 'Body.',
      siteUrl: 'https://tale.dev',
    });

    expect(out).toContain('title: "She said \\"hi\\""');
  });

  it('rewrites relative links to absolute URLs and leaves externals alone', () => {
    const out = pageAsMarkdown({
      frontmatter: null,
      body: [
        'See [pricing](/pricing) for details.',
        'External: [GitHub](https://github.com/tale).',
        'Mailto: [contact](mailto:hi@tale.dev).',
      ].join('\n'),
      siteUrl: 'https://tale.dev',
    });

    expect(out).toContain('[pricing](https://tale.dev/pricing)');
    expect(out).toContain('[GitHub](https://github.com/tale)');
    expect(out).toContain('[contact](mailto:hi@tale.dev)');
  });

  it('omits the frontmatter block when set to null', () => {
    const out = pageAsMarkdown({
      frontmatter: null,
      body: 'Body.',
      siteUrl: 'https://tale.dev',
    });

    expect(out.startsWith('---')).toBe(false);
    expect(out).toBe('Body.\n');
  });

  it('escapes backslashes, newlines, CRs, and tabs in frontmatter values', () => {
    // A literal newline inside a YAML double-quoted scalar is a syntax
    // error; backslashes must be escaped first so we don't re-escape
    // our own escape sequences.
    const out = pageAsMarkdown({
      frontmatter: { title: 'a\\b\n\tc\rd' },
      body: 'x',
      siteUrl: 'https://tale.dev',
    });
    expect(out).toContain('title: "a\\\\b\\n\\tc\\rd"');
    // No raw control characters survive the frontmatter block.
    const fmBlock = out.split('---\n')[1] ?? '';
    expect(fmBlock).not.toMatch(/\t/);
    expect(fmBlock.split('\n').length).toBeLessThan(10);
  });

  it('rewrites paths that contain backslash-escaped parens', () => {
    const out = pageAsMarkdown({
      frontmatter: null,
      body: 'Read [white-paper](/docs/whitepaper\\(v2\\).pdf).',
      siteUrl: 'https://tale.dev',
    });
    expect(out).toContain(
      '[white-paper](https://tale.dev/docs/whitepaper\\(v2\\).pdf)',
    );
  });
});
