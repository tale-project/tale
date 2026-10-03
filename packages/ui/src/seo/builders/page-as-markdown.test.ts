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

  it('resolves actual destinations against the source page without rewriting code', () => {
    const body = [
      '[next](../next?tab=setup#install "Keep this title")',
      '![diagram](./images/flow.svg)',
      '[section](#limits) [query](?view=all) [cdn](//cdn.example/logo.svg)',
      '[reference][guide]',
      '',
      "[guide]: </get-started/white paper> 'Keep this title too'",
      '',
      '`[literal](/example)` and ``<Card href="/example">``',
      '',
      '```md',
      '[literal](/example)',
      '<img src="/example.svg">',
      '```',
      '',
      '    [indented](/example)',
    ].join('\n');
    const out = pageAsMarkdown({
      frontmatter: null,
      body,
      siteUrl: 'https://docs.example.test/',
      pageUrl: 'https://docs.example.test/de/start/install',
    });

    expect(out).toBe(
      body
        .replace(
          '../next?tab=setup#install',
          'https://docs.example.test/de/next?tab=setup#install',
        )
        .replace(
          './images/flow.svg',
          'https://docs.example.test/de/start/images/flow.svg',
        )
        .replace(
          '](#limits)',
          '](https://docs.example.test/de/start/install#limits)',
        )
        .replace(
          '](?view=all)',
          '](https://docs.example.test/de/start/install?view=all)',
        )
        .replace('](//cdn.example/logo.svg)', '](https://cdn.example/logo.svg)')
        .replace(
          '</get-started/white paper>',
          '<https://docs.example.test/get-started/white%20paper>',
        ) + '\n',
    );
  });

  it('normalizes HTML destinations, preserving titles, comments and raw examples', () => {
    const body = [
      '<Card title="A > B, href=\'/not-a-link\'" href="/get-started/editors">',
      'Start here.',
      '</Card>',
      '',
      '<img src=flow.svg alt="Flow"> <video src=\'../walkthrough.webm\' poster="/poster.png" captions="/captions.vtt"></video>',
      '',
      '<a href="?q=&quot;x&quot;&amp;copy=1#top">Query</a>',
      '<!-- <a href="/example">Comment</a> -->',
      '<pre><a href="/example">Literal HTML</a></pre>',
      '<code>[literal](/example) <img src="/example.svg"></code>',
      '<script src="/script.js">const sample = \'<a href="/example">\';</script>',
      '<iframe src="/embed">[literal](/example)</iframe>',
      '<textarea>[literal](/example) <img src="/example.svg"></textarea>',
      '',
      'Literal <code>[literal](/example)</code> alongside [guide](/guide).',
      '',
      '<img src=./literal.svg alt="Not parsed as HTML by CommonMark">',
    ].join('\n');
    const out = pageAsMarkdown({
      frontmatter: null,
      body,
      siteUrl: 'https://docs.example.test',
      pageUrl: 'https://docs.example.test/get-started/install',
    });

    expect(out).toBe(
      body
        .replace(
          'href="/get-started/editors"',
          'href="https://docs.example.test/get-started/editors"',
        )
        .replace(
          'src=flow.svg',
          'src="https://docs.example.test/get-started/flow.svg"',
        )
        .replace(
          "src='../walkthrough.webm'",
          "src='https://docs.example.test/walkthrough.webm'",
        )
        .replace(
          'poster="/poster.png"',
          'poster="https://docs.example.test/poster.png"',
        )
        .replace(
          'captions="/captions.vtt"',
          'captions="https://docs.example.test/captions.vtt"',
        )
        .replace(
          'href="?q=&quot;x&quot;&amp;copy=1#top"',
          'href="https://docs.example.test/get-started/install?q=%22x%22&amp;copy=1#top"',
        )
        .replace(
          'src="/script.js"',
          'src="https://docs.example.test/script.js"',
        )
        .replace('src="/embed"', 'src="https://docs.example.test/embed"')
        .replace(
          '[guide](/guide)',
          '[guide](https://docs.example.test/guide)',
        ) + '\n',
    );
  });

  it('escapes resolved Markdown URLs once and preserves explicit schemes', () => {
    const body =
      '[paper](./paper\\(v2\\).pdf?q=&amp;copy; "Title") [mail](mailto:hi@tale.dev) [external](https://example.com/?x=&amp;y=2)';
    const out = pageAsMarkdown({
      frontmatter: null,
      body,
      siteUrl: 'https://tale.dev',
      pageUrl: 'https://tale.dev/docs/install/',
    });
    expect(out).toBe(
      body.replace(
        './paper\\(v2\\).pdf?q=&amp;copy;',
        'https://tale.dev/docs/install/paper\\(v2\\).pdf?q=&amp;copy;',
      ) + '\n',
    );
    expect(
      pageAsMarkdown({
        frontmatter: null,
        body: out,
        siteUrl: 'https://tale.dev',
        pageUrl: 'https://tale.dev/other',
      }),
    ).toBe(out);
  });

  it('preserves container prefixes and formatting around multiline HTML attributes', () => {
    const body =
      '> <Card\n> title="Guide"\n> href =\n> "/start">\n> Read this.\n> </Card>';
    expect(
      pageAsMarkdown({
        frontmatter: null,
        body,
        siteUrl: 'https://docs.example.test',
      }),
    ).toBe(
      body.replace('"/start"', '"https://docs.example.test/start"') + '\n',
    );
  });

  it('edits each source attribute once when HTML recovery clones its element', () => {
    const body = '<b href="/a"><i href="/b"></b>outside</i>';
    expect(
      pageAsMarkdown({ frontmatter: null, body, siteUrl: 'https://tale.dev' }),
    ).toBe(
      '<b href="https://tale.dev/a"><i href="https://tale.dev/b"></b>outside</i>\n',
    );
  });
});
