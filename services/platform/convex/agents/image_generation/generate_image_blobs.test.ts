import { describe, expect, it } from 'vitest';

import { parseDataUri } from './generate_image_blobs';

describe('parseDataUri', () => {
  it('decodes a base64 PNG data URI into bytes + media type', () => {
    // 1x1 transparent PNG.
    const b64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const parsed = parseDataUri(`data:image/png;base64,${b64}`);
    expect(parsed?.mediaType).toBe('image/png');
    expect(parsed?.bytes).toBeInstanceOf(Uint8Array);
    expect((parsed?.bytes.length ?? 0) > 0).toBe(true);
  });

  it('reads the media type from the URI (jpeg)', () => {
    const parsed = parseDataUri('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    expect(parsed?.mediaType).toBe('image/jpeg');
  });

  it('returns null for a non-data URI', () => {
    expect(parseDataUri('https://example.com/cat.png')).toBeNull();
    expect(parseDataUri('not a uri')).toBeNull();
  });

  it('returns null for a data URI with an empty payload', () => {
    expect(parseDataUri('data:image/png;base64,')).toBeNull();
  });
});
