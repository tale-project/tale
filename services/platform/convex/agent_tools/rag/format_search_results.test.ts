import { describe, expect, it } from 'vitest';

import {
  extractCitationsFromSearchResults,
  formatSearchResults,
} from './format_search_results';

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

  it('includes file_id annotation when file_id is provided', () => {
    const result = formatSearchResults([
      {
        content: 'Content',
        score: 0.8,
        file_id: 'doc-123',
        metadata: { source: 'test' },
      },
    ]);
    expect(result).toBe('[1] (Relevance: 80.0%) [FileID: doc-123]\nContent');
  });

  it('includes source annotation when filename is provided', () => {
    const result = formatSearchResults([
      { content: 'Content', score: 0.8, filename: 'report.pdf' },
    ]);
    expect(result).toBe('[1] (Relevance: 80.0%) [Source: report.pdf]\nContent');
  });

  it('includes both source and file_id annotations', () => {
    const result = formatSearchResults([
      {
        content: 'Content',
        score: 0.8,
        filename: 'report.pdf',
        file_id: 'doc-123',
      },
    ]);
    expect(result).toBe(
      '[1] (Relevance: 80.0%) [Source: report.pdf] [FileID: doc-123]\nContent',
    );
  });

  it('includes modified date annotation when source_modified_at is provided', () => {
    const result = formatSearchResults([
      {
        content: 'Content',
        score: 0.8,
        filename: 'report.pdf',
        source_modified_at: '2023-06-15T14:30:52Z',
        file_id: 'doc-123',
      },
    ]);
    expect(result).toBe(
      '[1] (Relevance: 80.0%) [Source: report.pdf] [Modified: 2023-06-15] [FileID: doc-123]\nContent',
    );
  });

  it('omits modified date annotation when source_modified_at is null', () => {
    const result = formatSearchResults([
      {
        content: 'Content',
        score: 0.8,
        filename: 'report.pdf',
        source_modified_at: null,
      },
    ]);
    expect(result).toBe('[1] (Relevance: 80.0%) [Source: report.pdf]\nContent');
  });

  it('includes created date annotation when only source_created_at is provided', () => {
    const result = formatSearchResults([
      {
        content: 'Content',
        score: 0.8,
        filename: 'report.pdf',
        source_created_at: '2023-01-10T09:00:00Z',
        source_modified_at: null,
        file_id: 'doc-123',
      },
    ]);
    expect(result).toBe(
      '[1] (Relevance: 80.0%) [Source: report.pdf] [Created: 2023-01-10] [FileID: doc-123]\nContent',
    );
  });

  it('prefers modified date over created date when both are provided', () => {
    const result = formatSearchResults([
      {
        content: 'Content',
        score: 0.8,
        source_created_at: '2023-01-10T09:00:00Z',
        source_modified_at: '2023-06-15T14:30:52Z',
      },
    ]);
    expect(result).toBe(
      '[1] (Relevance: 80.0%) [Modified: 2023-06-15]\nContent',
    );
  });

  it('omits annotations when filename and file_id are undefined', () => {
    const result = formatSearchResults([
      { content: 'Content', score: 0.8, filename: undefined },
    ]);
    expect(result).toBe('[1] (Relevance: 80.0%)\nContent');
  });
});

describe('extractCitationsFromSearchResults', () => {
  it('returns empty array for empty results', () => {
    expect(extractCitationsFromSearchResults([])).toEqual([]);
  });

  it('extracts citation from a single result with all metadata', () => {
    const citations = extractCitationsFromSearchResults([
      {
        content: 'Hello world',
        score: 0.873,
        file_id: 'doc-123',
        filename: 'report.pdf',
      },
    ]);
    expect(citations).toEqual([
      {
        index: 1,
        type: 'rag',
        source: 'report.pdf',
        fileId: 'doc-123',
        relevance: 0.873,
      },
    ]);
  });

  it('extracts citations from multiple results with correct indices', () => {
    const citations = extractCitationsFromSearchResults([
      { content: 'A', score: 0.9, file_id: 'doc-1', filename: 'a.pdf' },
      { content: 'B', score: 0.7, file_id: 'doc-2', filename: 'b.pdf' },
    ]);
    expect(citations).toHaveLength(2);
    expect(citations[0].index).toBe(1);
    expect(citations[1].index).toBe(2);
    expect(citations[0].source).toBe('a.pdf');
    expect(citations[1].source).toBe('b.pdf');
  });

  it('deduplicates by file_id and keeps highest score', () => {
    const citations = extractCitationsFromSearchResults([
      {
        content: 'Chunk 1',
        score: 0.85,
        file_id: 'doc-123',
        filename: 'report.pdf',
      },
      {
        content: 'Chunk 2',
        score: 0.72,
        file_id: 'doc-456',
        filename: 'memo.docx',
      },
      {
        content: 'Chunk 3',
        score: 0.9,
        file_id: 'doc-123',
        filename: 'report.pdf',
      },
    ]);
    expect(citations).toHaveLength(2);
    expect(citations[0]).toEqual({
      index: 1,
      type: 'rag',
      source: 'report.pdf',
      fileId: 'doc-123',
      relevance: 0.9,
    });
    expect(citations[1].source).toBe('memo.docx');
  });

  it('falls back to filename then unknown-N when file_id is missing', () => {
    const citations = extractCitationsFromSearchResults([
      { content: 'A', score: 0.8, filename: 'report.pdf' },
      { content: 'B', score: 0.7 },
    ]);
    expect(citations).toHaveLength(2);
    expect(citations[0].source).toBe('report.pdf');
    expect(citations[0]).not.toHaveProperty('fileId');
    expect(citations[1].source).toBe('Unknown');
  });

  it('preserves relevance of 0 (not filtered by falsy check)', () => {
    const citations = extractCitationsFromSearchResults([
      { content: 'A', score: 0, file_id: 'doc-1', filename: 'a.pdf' },
    ]);
    expect(citations[0].relevance).toBe(0);
  });

  it('omits undefined optional fields for Convex compatibility', () => {
    const citations = extractCitationsFromSearchResults([
      { content: 'A', score: 0.5 },
    ]);
    expect(citations[0]).not.toHaveProperty('fileId');
    // relevance is always set from score
    expect(citations[0].relevance).toBe(0.5);
    expect(citations[0]).not.toHaveProperty('url');
    expect(citations[0]).not.toHaveProperty('page');
  });
});
