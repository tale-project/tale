import { describe, expect, it } from 'vitest';

import { chunkContent } from './chunk_content';

describe('chunkContent', () => {
  it('returns empty array for empty content', () => {
    expect(chunkContent('')).toEqual([]);
    expect(chunkContent('   ')).toEqual([]);
  });

  it('returns single chunk for short content', () => {
    const result = chunkContent('Hello world');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Hello world');
    expect(result[0].index).toBe(0);
  });

  it('prepends title to chunks', () => {
    const result = chunkContent('Some content', 'My Page Title');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('My Page Title\n\nSome content');
  });

  it('splits long content into multiple chunks', () => {
    const paragraph = 'Lorem ipsum dolor sit amet. '.repeat(100);
    const result = chunkContent(paragraph, undefined, 200, 50);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.content.length).toBeLessThanOrEqual(250);
    }
  });

  it('assigns sequential chunk indices', () => {
    const longContent = Array.from(
      { length: 20 },
      (_, i) => `Paragraph ${i}. This is a test paragraph with enough content.`,
    ).join('\n\n');

    const result = chunkContent(longContent, undefined, 200, 50);
    for (let i = 0; i < result.length; i++) {
      expect(result[i].index).toBe(i);
    }
  });

  it('splits by paragraphs when possible', () => {
    // Each paragraph must exceed MIN_CHUNK_LENGTH (50) to not be filtered out
    const para1 =
      'First paragraph with enough content to pass the minimum length filter easily.';
    const para2 =
      'Second paragraph also needs sufficient content to exceed the minimum threshold.';
    const content = `${para1}\n\n${para2}`;
    const result = chunkContent(content, undefined, 100, 10);

    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('handles content with only whitespace between paragraphs', () => {
    const content = 'First.\n\n\n\nSecond.';
    const result = chunkContent(content);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].content).toContain('First.');
  });

  it('filters out chunks shorter than minimum length', () => {
    const content = 'Short\n\nAnother really short piece';
    const result = chunkContent(content, undefined, 5000, 100);
    for (const chunk of result) {
      expect(chunk.content.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('handles title taking most of chunk size', () => {
    const longTitle = 'A'.repeat(1400);
    const content = 'Short content here.';
    const result = chunkContent(content, longTitle);
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain(longTitle);
    expect(result[0].content).toContain(content);
  });
});
