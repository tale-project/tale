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
});
