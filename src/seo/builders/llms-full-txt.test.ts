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
});
