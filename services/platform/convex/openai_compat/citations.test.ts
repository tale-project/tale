import { describe, expect, it } from 'vitest';

import { parseCitationsFromToolsUsage } from './citations';

describe('parseCitationsFromToolsUsage', () => {
  it('parses RAG citations from tool output', () => {
    const toolsUsage = [
      {
        toolName: 'rag_search',
        output:
          '[1] (Relevance: 87.3%) [Source: report.pdf] [Page: 42] [Modified: 2023-06-15] [FileID: doc-123]\nSome content here\n\n---\n\n[2] (Relevance: 72.1%) [Source: memo.docx] [Created: 2024-01-01] [FileID: doc-456]\nOther content',
      },
    ];

    const result = parseCitationsFromToolsUsage(toolsUsage);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      index: 1,
      type: 'rag',
      source: 'report.pdf',
      fileId: 'doc-123',
      page: 42,
      relevance: 0.873,
    });
    expect(result[1]).toEqual({
      index: 2,
      type: 'rag',
      source: 'memo.docx',
      fileId: 'doc-456',
      page: undefined,
      relevance: 0.721,
    });
  });

  it('parses web citations from tool output', () => {
    const toolsUsage = [
      {
        toolName: 'web',
        output:
          '[1] (Relevance: 85.2%) [Source: Example Page] [URL: https://example.com]\nPage content\n\n---\n\n[2] (Relevance: 65.0%) [Source: Another Page] [URL: https://other.com/path]\nMore content',
      },
    ];

    const result = parseCitationsFromToolsUsage(toolsUsage);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      index: 1,
      type: 'web',
      source: 'Example Page',
      url: 'https://example.com',
      relevance: 0.852,
    });
    expect(result[1]).toEqual({
      index: 2,
      type: 'web',
      source: 'Another Page',
      url: 'https://other.com/path',
      relevance: 0.65,
    });
  });

  it('offsets web citation indices after RAG citations', () => {
    const toolsUsage = [
      {
        toolName: 'rag_search',
        output:
          '[1] (Relevance: 90.0%) [Source: doc.pdf] [FileID: doc-1]\nContent\n\n---\n\n[2] (Relevance: 80.0%) [Source: doc2.pdf] [FileID: doc-2]\nContent',
      },
      {
        toolName: 'web',
        output:
          '[1] (Relevance: 75.0%) [Source: Web Page] [URL: https://web.com]\nContent',
      },
    ];

    const result = parseCitationsFromToolsUsage(toolsUsage);

    expect(result).toHaveLength(3);
    expect(result[0].index).toBe(1);
    expect(result[0].type).toBe('rag');
    expect(result[1].index).toBe(2);
    expect(result[1].type).toBe('rag');
    expect(result[2].index).toBe(3);
    expect(result[2].type).toBe('web');
  });

  it('returns empty array for empty toolsUsage', () => {
    expect(parseCitationsFromToolsUsage([])).toEqual([]);
  });

  it('returns empty array when no tools have output', () => {
    const toolsUsage = [
      { toolName: 'rag_search', output: undefined },
      { toolName: 'web', output: '' },
    ];

    expect(parseCitationsFromToolsUsage(toolsUsage)).toEqual([]);
  });

  it('ignores tools that are not rag_search or web', () => {
    const toolsUsage = [
      {
        toolName: 'some_other_tool',
        output: '[1] (Relevance: 50.0%) [Source: test] [FileID: x]\nContent',
      },
    ];

    expect(parseCitationsFromToolsUsage(toolsUsage)).toEqual([]);
  });

  it('unwraps JSON-stringified output', () => {
    const rawOutput =
      '[1] (Relevance: 87.3%) [Source: report.pdf] [FileID: doc-123]\nContent';
    const toolsUsage = [
      {
        toolName: 'rag_search',
        output: JSON.stringify(rawOutput),
      },
    ];

    const result = parseCitationsFromToolsUsage(toolsUsage);

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('report.pdf');
  });

  it('deduplicates citations with same source identity', () => {
    const toolsUsage = [
      {
        toolName: 'rag_search',
        output:
          '[1] (Relevance: 90.0%) [Source: doc.pdf] [Page: 1] [FileID: doc-1]\nContent\n\n---\n\n[2] (Relevance: 85.0%) [Source: doc.pdf] [Page: 1] [FileID: doc-1]\nMore content from same page',
      },
    ];

    const result = parseCitationsFromToolsUsage(toolsUsage);

    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(1);
  });

  it('keeps citations from same file but different pages', () => {
    const toolsUsage = [
      {
        toolName: 'rag_search',
        output:
          '[1] (Relevance: 90.0%) [Source: doc.pdf] [Page: 1] [FileID: doc-1]\nContent\n\n---\n\n[2] (Relevance: 85.0%) [Source: doc.pdf] [Page: 5] [FileID: doc-1]\nContent from different page',
      },
    ];

    const result = parseCitationsFromToolsUsage(toolsUsage);

    expect(result).toHaveLength(2);
  });

  it('deduplicates web citations with same URL', () => {
    const toolsUsage = [
      {
        toolName: 'web',
        output:
          '[1] (Relevance: 90.0%) [Source: Page A] [URL: https://example.com]\nContent\n\n---\n\n[2] (Relevance: 80.0%) [Source: Page B] [URL: https://example.com]\nDuplicate URL content',
      },
    ];

    const result = parseCitationsFromToolsUsage(toolsUsage);

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('Page A');
  });

  it('sorts citations by index', () => {
    const toolsUsage = [
      {
        toolName: 'rag_search',
        output:
          '[3] (Relevance: 70.0%) [Source: c.pdf] [FileID: doc-3]\nC\n\n---\n\n[1] (Relevance: 90.0%) [Source: a.pdf] [FileID: doc-1]\nA\n\n---\n\n[2] (Relevance: 80.0%) [Source: b.pdf] [FileID: doc-2]\nB',
      },
    ];

    const result = parseCitationsFromToolsUsage(toolsUsage);

    expect(result.map((c) => c.index)).toEqual([1, 2, 3]);
  });

  it('handles RAG citation without optional fields', () => {
    const toolsUsage = [
      {
        toolName: 'rag_search',
        output: '[1] (Relevance: 50.0%)\nMinimal content',
      },
    ];

    const result = parseCitationsFromToolsUsage(toolsUsage);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      index: 1,
      type: 'rag',
      source: 'Unknown',
      fileId: undefined,
      page: undefined,
      relevance: 0.5,
    });
  });

  it('handles malformed output gracefully', () => {
    const toolsUsage = [
      {
        toolName: 'rag_search',
        output: 'This is not a citation format at all',
      },
    ];

    expect(parseCitationsFromToolsUsage(toolsUsage)).toEqual([]);
  });
});
