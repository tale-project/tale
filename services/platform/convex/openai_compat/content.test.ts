import { describe, expect, it } from 'vitest';

import {
  buildAiUserContent,
  extractText,
  hasUsableUserContent,
  imageUrlsOf,
  type OpenAIContentPart,
} from './content';

describe('extractText', () => {
  it('returns a string content unchanged', () => {
    expect(extractText('hello world')).toBe('hello world');
  });

  it('joins text parts and ignores image parts', () => {
    const content: OpenAIContentPart[] = [
      { type: 'text', text: 'describe this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'text', text: 'in detail' },
    ];
    expect(extractText(content)).toBe('describe this\nin detail');
  });

  it('returns empty string for an image-only array', () => {
    const content: OpenAIContentPart[] = [
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    ];
    expect(extractText(content)).toBe('');
  });
});

describe('hasUsableUserContent', () => {
  it('accepts a non-empty string', () => {
    expect(hasUsableUserContent('hi')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(hasUsableUserContent('')).toBe(false);
  });

  it('accepts an array with a text part', () => {
    expect(hasUsableUserContent([{ type: 'text', text: 'hi' }])).toBe(true);
  });

  it('accepts an array with only an image part (vision)', () => {
    expect(
      hasUsableUserContent([
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ]),
    ).toBe(true);
  });

  it('rejects an empty array', () => {
    expect(hasUsableUserContent([])).toBe(false);
  });

  it('rejects an array of unrecognized parts', () => {
    expect(hasUsableUserContent([{ type: 'audio' }, { foo: 1 }])).toBe(false);
  });

  it('rejects a null/undefined content', () => {
    expect(hasUsableUserContent(null)).toBe(false);
    expect(hasUsableUserContent(undefined)).toBe(false);
  });
});

describe('imageUrlsOf', () => {
  it('returns image_url URLs in order, ignoring text parts', () => {
    const content: OpenAIContentPart[] = [
      { type: 'text', text: 'edit this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'image_url', image_url: { url: 'https://example.com/b.png' } },
    ];
    expect(imageUrlsOf(content)).toEqual([
      'data:image/png;base64,AAAA',
      'https://example.com/b.png',
    ]);
  });

  it('returns empty for a string or text-only content', () => {
    expect(imageUrlsOf('hello')).toEqual([]);
    expect(imageUrlsOf([{ type: 'text', text: 'hi' }])).toEqual([]);
  });
});

describe('buildAiUserContent', () => {
  it('returns the sanitized text for plain string content', () => {
    expect(buildAiUserContent('original', 'sanitized')).toBe('sanitized');
  });

  it('returns a plain string when the array has no image parts', () => {
    const content: OpenAIContentPart[] = [{ type: 'text', text: 'hi' }];
    expect(buildAiUserContent(content, 'sanitized')).toBe('sanitized');
  });

  it('builds text + image parts, substituting the sanitized text', () => {
    const content: OpenAIContentPart[] = [
      { type: 'text', text: 'raw secret 4111-1111-1111-1111' },
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    ];
    expect(buildAiUserContent(content, 'raw secret [REDACTED]')).toEqual([
      { type: 'text', text: 'raw secret [REDACTED]' },
      { type: 'image', image: 'https://example.com/a.png' },
    ]);
  });

  it('omits the text part when the sanitized text is empty (image-only)', () => {
    const content: OpenAIContentPart[] = [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ];
    expect(buildAiUserContent(content, '')).toEqual([
      { type: 'image', image: 'data:image/png;base64,AAAA' },
    ]);
  });
});
