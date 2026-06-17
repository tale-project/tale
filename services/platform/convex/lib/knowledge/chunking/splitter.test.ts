import { describe, expect, it } from 'vitest';

import {
  buildMetadataPrefix,
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  chunkContent,
  MIN_CHUNK_LENGTH,
} from './splitter';

describe('chunkContent', () => {
  it('returns empty for empty/whitespace input', () => {
    expect(chunkContent('')).toEqual([]);
    expect(chunkContent('   ')).toEqual([]);
  });

  it('returns empty for null/undefined input', () => {
    expect(chunkContent(null)).toEqual([]);
    expect(chunkContent(undefined)).toEqual([]);
  });

  it('keeps short content in a single chunk', () => {
    const text = `Hello world, this is a test of chunking.${' extra'.repeat(10)}`;
    const chunks = chunkContent(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].index).toBe(0);
  });

  it('assigns sequential indexes', () => {
    const text = `# Section\n\n${`${'word '.repeat(500)}\n\n`.repeat(5)}`;
    const chunks = chunkContent(text);
    chunks.forEach((chunk, i) => expect(chunk.index).toBe(i));
  });

  it('still produces a chunk for tiny content', () => {
    const chunks = chunkContent('Hi');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].coreContent).toBe('Hi');
  });

  it('indexes short CJK content', () => {
    const text = '2025年我们的销售额度是1000万';
    const chunks = chunkContent(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].index).toBe(0);
  });

  it('produces more chunks with a smaller chunk size', () => {
    const text = 'word '.repeat(1000);
    const small = chunkContent(text, { chunkSize: 200, chunkOverlap: 20 });
    const large = chunkContent(text, { chunkSize: 2000, chunkOverlap: 20 });
    expect(small.length).toBeGreaterThan(large.length);
  });

  it('exposes the documented default constants', () => {
    expect(CHUNK_SIZE).toBe(2048);
    expect(CHUNK_OVERLAP).toBe(200);
    expect(MIN_CHUNK_LENGTH).toBe(10);
  });

  it('splits long content into multiple chunks', () => {
    const text = `# Document Title\n\n${`${'This is a paragraph of text. '.repeat(50)}\n\n`.repeat(10)}`;
    expect(chunkContent(text).length).toBeGreaterThan(1);
  });
});

describe('buildMetadataPrefix', () => {
  it('formats title and url', () => {
    expect(buildMetadataPrefix('My Page', 'https://example.com/page')).toBe(
      'My Page\n\nhttps://example.com/page\n\n',
    );
  });

  it('formats title only', () => {
    expect(buildMetadataPrefix('Title', null)).toBe('Title\n\n');
  });

  it('formats url only', () => {
    expect(buildMetadataPrefix(null, 'https://example.com')).toBe(
      'https://example.com\n\n',
    );
  });

  it('returns empty for both null', () => {
    expect(buildMetadataPrefix(null, null)).toBe('');
  });

  it('returns empty for blank strings', () => {
    expect(buildMetadataPrefix('   ', '')).toBe('');
  });

  it('trims title and url', () => {
    expect(buildMetadataPrefix('  Title  ', '  https://x.com  ')).toBe(
      'Title\n\nhttps://x.com\n\n',
    );
  });
});
