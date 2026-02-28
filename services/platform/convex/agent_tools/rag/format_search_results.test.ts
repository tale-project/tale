import { describe, expect, it } from 'vitest';

import { formatSearchResults } from './format_search_results';

describe('formatSearchResults', () => {
  it('returns undefined for empty results', () => {
    expect(formatSearchResults([])).toBeUndefined();
  });

  it('formats a single result', () => {
    const result = formatSearchResults([
      { content: 'Hello world', score: 0.873 },
    ]);
    expect(result).toBe('[1] (Relevance: 87.3%)\nHello world');
  });

  it('formats multiple results separated by ---', () => {
    const result = formatSearchResults([
      { content: 'First chunk', score: 0.9 },
      { content: 'Second chunk', score: 0.7 },
    ]);
    expect(result).toBe(
      '[1] (Relevance: 90.0%)\nFirst chunk\n\n---\n\n[2] (Relevance: 70.0%)\nSecond chunk',
    );
  });

  it('handles scores at boundaries', () => {
    const result = formatSearchResults([
      { content: 'Perfect match', score: 1.0 },
      { content: 'Zero match', score: 0.0 },
    ]);
    expect(result).toContain('Relevance: 100.0%');
    expect(result).toContain('Relevance: 0.0%');
  });

  it('preserves content with newlines and special characters', () => {
    const result = formatSearchResults([
      { content: 'Line 1\nLine 2\n\nParagraph 2', score: 0.5 },
    ]);
    expect(result).toBe(
      '[1] (Relevance: 50.0%)\nLine 1\nLine 2\n\nParagraph 2',
    );
  });

  it('ignores metadata and document_id in formatting', () => {
    const result = formatSearchResults([
      {
        content: 'Content',
        score: 0.8,
        document_id: 'doc-123',
        metadata: { source: 'test' },
      },
    ]);
    expect(result).toBe('[1] (Relevance: 80.0%)\nContent');
  });
});
