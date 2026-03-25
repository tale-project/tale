import { describe, expect, it } from 'vitest';

import { parseRagResults } from './parse_search_results';

describe('parseRagResults', () => {
  it('parses a single result without annotations', () => {
    const input = '[1] (Relevance: 87.3%)\nHello world';
    const entries = parseRagResults(input);
    expect(entries).toHaveLength(1);
    expect(entries[0].index).toBe(1);
    expect(entries[0].relevance).toBeCloseTo(0.873);
    expect(entries[0].fullMatch).toContain('Hello world');
  });

  it('parses multiple results separated by ---', () => {
    const input =
      '[1] (Relevance: 90.0%)\nFirst chunk\n\n---\n\n[2] (Relevance: 70.0%)\nSecond chunk';
    const entries = parseRagResults(input);
    expect(entries).toHaveLength(2);
    expect(entries[0].index).toBe(1);
    expect(entries[0].relevance).toBeCloseTo(0.9);
    expect(entries[1].index).toBe(2);
    expect(entries[1].relevance).toBeCloseTo(0.7);
  });

  it('parses result with Source annotation', () => {
    const input = '[1] (Relevance: 80.0%) [Source: report.pdf]\nContent here';
    const entries = parseRagResults(input);
    expect(entries).toHaveLength(1);
    expect(entries[0].relevance).toBeCloseTo(0.8);
  });

  it('parses result with Modified date annotation', () => {
    const input =
      '[1] (Relevance: 80.0%) [Source: report.pdf] [Modified: 2023-06-15] [FileID: doc-123]\nContent';
    const entries = parseRagResults(input);
    expect(entries).toHaveLength(1);
    expect(entries[0].relevance).toBeCloseTo(0.8);
    expect(entries[0].fullMatch).toContain('Content');
  });

  it('parses result with Created date annotation', () => {
    const input =
      '[1] (Relevance: 80.0%) [Source: report.pdf] [Created: 2023-01-10] [FileID: doc-123]\nContent';
    const entries = parseRagResults(input);
    expect(entries).toHaveLength(1);
    expect(entries[0].relevance).toBeCloseTo(0.8);
  });

  it('parses result with all annotations', () => {
    const input =
      '[1] (Relevance: 95.0%) [Source: doc.pdf] [Modified: 2024-01-01] [FileID: f-1]\nChunk text\n\n---\n\n[2] (Relevance: 60.0%) [Source: memo.docx] [Created: 2023-12-01] [FileID: f-2]\nOther text';
    const entries = parseRagResults(input);
    expect(entries).toHaveLength(2);
    expect(entries[0].index).toBe(1);
    expect(entries[0].relevance).toBeCloseTo(0.95);
    expect(entries[1].index).toBe(2);
    expect(entries[1].relevance).toBeCloseTo(0.6);
  });

  it('returns empty array for empty string', () => {
    expect(parseRagResults('')).toHaveLength(0);
  });

  it('returns empty array for non-matching input', () => {
    expect(parseRagResults('This is just plain text')).toHaveLength(0);
  });
});
