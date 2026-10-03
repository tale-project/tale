import { describe, expect, it } from 'vitest';

import { buildLlmsFullTxt } from './llms-full-txt';

describe('buildLlmsFullTxt', () => {
  it('emits one block per page in the expected format', () => {
    const out = buildLlmsFullTxt([
      {
        title: 'Home',
        url: 'https://tale.dev/',
        body: 'Welcome to Tale.',
      },
      {
        title: 'Pricing',
        url: 'https://tale.dev/pricing',
        body: 'One price.',
      },
    ]);

    expect(out).toBe(
      [
        '# Home',
        'Source: https://tale.dev/',
        '',
        'Welcome to Tale.',
        '',
        '# Pricing',
        'Source: https://tale.dev/pricing',
        '',
        'One price.',
        '',
      ].join('\n'),
    );
  });

  it('trims surrounding whitespace from each body', () => {
    const out = buildLlmsFullTxt([
      {
        title: 'Home',
        url: 'https://tale.dev/',
        body: '\n\n  hello  \n\n',
      },
    ]);

    expect(out).toContain('\n\nhello\n');
    // Body's leading/trailing whitespace is gone (only the spacer blank line
    // remains between Source: and body).
    expect(out).not.toContain('hello  ');
  });

  it('returns an empty string for an empty page list', () => {
    expect(buildLlmsFullTxt([])).toBe('');
  });

  it('resolves each page body against its own canonical URL', () => {
    const out = buildLlmsFullTxt([
      {
        title: 'Product docs',
        url: 'https://docs.example.test/fr/get-started/install',
        body: '[next](./next#setup) <Card href="/platform/tasks">\n\n`[sample](/unchanged)`',
      },
      {
        title: 'UI docs',
        url: 'https://ui.example.test/docs/components/button',
        body: '![diagram](../images/button.svg) [section](#examples)',
      },
    ]);
    expect(out).toContain(
      '[next](https://docs.example.test/fr/get-started/next#setup)',
    );
    expect(out).toContain(
      '<Card href="https://docs.example.test/platform/tasks">',
    );
    expect(out).toContain('`[sample](/unchanged)`');
    expect(out).toContain(
      '![diagram](https://ui.example.test/docs/images/button.svg)',
    );
    expect(out).toContain(
      '[section](https://ui.example.test/docs/components/button#examples)',
    );
  });

  it('keeps site-relative destinations under the configured aggregate mount', () => {
    const out = buildLlmsFullTxt(
      [
        {
          title: 'Setup',
          url: 'https://docs.example.test/guides/de/start/install',
          body: [
            '[setup](/setup) [next](../next) [section](#limits) [query](?view=all)',
            '[cdn](//cdn.example.test/asset.svg)',
            '',
            '<Card href="/setup"><img src="/images/flow.svg"></Card>',
            '<Video src="/videos/demo.webm" poster="/images/poster.png" captions="/videos/demo.vtt" />',
          ].join('\n'),
        },
      ],
      'https://docs.example.test/guides/',
    );
    expect(out).toBe(
      [
        '# Setup',
        'Source: https://docs.example.test/guides/de/start/install',
        '',
        '[setup](https://docs.example.test/guides/setup) [next](https://docs.example.test/guides/de/next) [section](https://docs.example.test/guides/de/start/install#limits) [query](https://docs.example.test/guides/de/start/install?view=all)',
        '[cdn](https://cdn.example.test/asset.svg)',
        '',
        '<Card href="https://docs.example.test/guides/setup"><img src="https://docs.example.test/guides/images/flow.svg"></Card>',
        '<Video src="https://docs.example.test/guides/videos/demo.webm" poster="https://docs.example.test/guides/images/poster.png" captions="https://docs.example.test/guides/videos/demo.vtt" />',
        '',
      ].join('\n'),
    );
  });
});
