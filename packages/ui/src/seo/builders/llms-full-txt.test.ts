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
        url: 'https://docs.tale.dev/fr/get-started/install',
        body: '[next](./next#setup) <Card href="/platform/tasks">\n\n`[sample](/unchanged)`',
      },
      {
        title: 'UI docs',
        url: 'https://ui.tale.dev/docs/components/button',
        body: '![diagram](../images/button.svg) [section](#examples)',
      },
    ]);
    expect(out).toContain(
      '[next](https://docs.tale.dev/fr/get-started/next#setup)',
    );
    expect(out).toContain('<Card href="https://docs.tale.dev/platform/tasks">');
    expect(out).toContain('`[sample](/unchanged)`');
    expect(out).toContain(
      '![diagram](https://ui.tale.dev/docs/images/button.svg)',
    );
    expect(out).toContain(
      '[section](https://ui.tale.dev/docs/components/button#examples)',
    );
  });
});
