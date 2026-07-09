import { describe, expect, it } from 'vitest';

import { rebaseImageSrc } from './image-src';

describe('rebaseImageSrc', () => {
  it('prefixes root-absolute srcs with a sub-path base', () => {
    expect(
      rebaseImageSrc('/docs/', '/images/platform/chat-composer.webp'),
    ).toBe('/docs/images/platform/chat-composer.webp');
  });

  it('leaves root-absolute srcs untouched at the root base', () => {
    expect(rebaseImageSrc('/', '/images/platform/chat-composer.webp')).toBe(
      '/images/platform/chat-composer.webp',
    );
  });

  it('tolerates a base without a trailing slash', () => {
    expect(rebaseImageSrc('/docs', '/images/a.webp')).toBe(
      '/docs/images/a.webp',
    );
  });

  it('leaves scheme’d and protocol-relative URLs untouched', () => {
    expect(rebaseImageSrc('/docs/', 'https://example.com/a.webp')).toBe(
      'https://example.com/a.webp',
    );
    expect(rebaseImageSrc('/docs/', 'data:image/png;base64,AAAA')).toBe(
      'data:image/png;base64,AAAA',
    );
    expect(rebaseImageSrc('/docs/', '//cdn.example.com/a.webp')).toBe(
      '//cdn.example.com/a.webp',
    );
  });

  it('leaves relative and missing srcs untouched', () => {
    expect(rebaseImageSrc('/docs/', 'relative/a.webp')).toBe('relative/a.webp');
    expect(rebaseImageSrc('/docs/', undefined)).toBeUndefined();
    expect(rebaseImageSrc('/docs/', '')).toBe('');
  });
});
