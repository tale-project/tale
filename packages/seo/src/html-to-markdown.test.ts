import { describe, expect, it } from 'vitest';

import { htmlToMarkdown } from './html-to-markdown';

describe('htmlToMarkdown', () => {
  it('renders headings, paragraphs, and inline emphasis', async () => {
    const out = await htmlToMarkdown(
      '<h1>Hello</h1><p>This is <strong>bold</strong> and <em>italic</em>.</p>',
    );
    expect(out).toContain('# Hello');
    expect(out).toContain('This is **bold** and *italic*.');
  });

  it('renders unordered and ordered lists', async () => {
    const out = await htmlToMarkdown(
      '<ul><li>One</li><li>Two</li></ul><ol><li>A</li><li>B</li></ol>',
    );
    expect(out).toContain('- One');
    expect(out).toContain('- Two');
    expect(out).toContain('1. A');
    expect(out).toContain('2. B');
  });

  it('renders a table with a header row', async () => {
    const out = await htmlToMarkdown(
      [
        '<table>',
        '<tr><th>Name</th><th>Price</th></tr>',
        '<tr><td>Pro</td><td>$10</td></tr>',
        '</table>',
      ].join(''),
    );
    expect(out).toContain('| Name | Price |');
    expect(out).toContain('| --- | --- |');
    expect(out).toContain('| Pro | $10 |');
  });

  it('rewrites <a> with href as inline links', async () => {
    const out = await htmlToMarkdown(
      '<p>Visit <a href="https://tale.dev">Tale</a>.</p>',
    );
    expect(out).toContain('[Tale](https://tale.dev)');
  });

  it('drops chrome elements (nav/header/footer/script/style/svg/button)', async () => {
    const out = await htmlToMarkdown(
      [
        '<nav><a href="/">nav-link</a></nav>',
        '<header>top</header>',
        '<footer>bottom</footer>',
        '<script>alert(1)</script>',
        '<style>body{}</style>',
        '<svg><title>icon</title></svg>',
        '<button>Click</button>',
        '<p>Visible.</p>',
      ].join(''),
    );
    expect(out).not.toContain('nav-link');
    expect(out).not.toContain('top');
    expect(out).not.toContain('bottom');
    expect(out).not.toContain('alert(1)');
    expect(out).not.toContain('body{}');
    expect(out).not.toContain('icon');
    expect(out).not.toContain('Click');
    expect(out).toContain('Visible.');
  });

  it('drops aria-hidden and role-based chrome subtrees', async () => {
    const out = await htmlToMarkdown(
      [
        '<div aria-hidden="true">hidden</div>',
        '<div role="navigation">nav</div>',
        '<div role="contentinfo">footer</div>',
        '<p>Kept.</p>',
      ].join(''),
    );
    expect(out).not.toContain('hidden');
    expect(out).not.toContain('nav');
    expect(out).not.toContain('footer');
    expect(out).toContain('Kept.');
  });

  it('escapes pipes inside table cells', async () => {
    const out = await htmlToMarkdown(
      '<table><tr><th>A</th></tr><tr><td>a|b</td></tr></table>',
    );
    expect(out).toContain('| a\\|b |');
  });

  it('renders a description list as a bulleted "term: definition" list', async () => {
    const out = await htmlToMarkdown(
      '<dl><dt>One</dt><dd>First.</dd><dt>Two</dt><dd>Second.</dd></dl>',
    );
    expect(out).toContain('- **One**: First.');
    expect(out).toContain('- **Two**: Second.');
  });
});
