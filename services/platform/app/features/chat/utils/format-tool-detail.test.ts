import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import {
  extractHostname,
  formatToolDetail,
  truncate,
} from './format-tool-detail';

// Minimal translator stub mirroring the `chat` namespace keys the formatter
// touches. Cast to TFunction — the formatter only calls it as (key, params).
const t = ((key: string, params?: Record<string, string | number>) => {
  const p = (k: string) => String(params?.[k] ?? '');
  const translations: Record<string, string> = {
    'thinking.reading': `Reading ${p('hostname')}`,
    'thinking.searchingKnowledgeBase': `Searching knowledge base for "${p('query')}"`,
    'thinking.delegating': `Asking ${p('agent')}`,
    'tools.customerRead': 'Customer Read',
    'tools.ragSearch': 'Knowledge Base Search',
    'tools.web': 'Web',
    'tools.excel': 'Excel',
  };
  return translations[key] ?? key;
}) as unknown as TFunction;

describe('extractHostname', () => {
  it('strips protocol and www', () => {
    expect(extractHostname('https://www.example.com/path?q=1')).toBe(
      'example.com',
    );
  });

  it('returns the input on an unparseable URL', () => {
    expect(extractHostname('not a url')).toBe('not a url');
  });
});

describe('truncate', () => {
  it('leaves short strings intact', () => {
    expect(truncate('short', 25)).toBe('short');
  });

  it('adds an ellipsis past the max length', () => {
    expect(truncate('a'.repeat(30), 10)).toBe('a'.repeat(9) + '…');
  });
});

describe('formatToolDetail', () => {
  it('formats a web fetch_url as "Reading <hostname>"', () => {
    expect(
      formatToolDetail(t, 'web', {
        operation: 'fetch_url',
        url: 'https://www.acme.io/docs',
      }).displayText,
    ).toBe('Reading acme.io');
  });

  it('formats rag_search with a truncated query', () => {
    const { displayText } = formatToolDetail(t, 'rag_search', {
      query: 'a very long knowledge base query that should be truncated',
    });
    expect(displayText.startsWith('Searching knowledge base for "')).toBe(true);
    expect(displayText).toContain('…');
  });

  it('humanizes a delegate_* tool into the agent name', () => {
    expect(formatToolDetail(t, 'delegate_research_agent').displayText).toBe(
      'Asking Research Agent',
    );
  });

  it('uses the explicit tool display-name map', () => {
    expect(formatToolDetail(t, 'customer_read').displayText).toBe(
      'Customer Read',
    );
    expect(formatToolDetail(t, 'excel').displayText).toBe('Excel');
  });

  it('Title-Cases unknown snake_case tool names', () => {
    expect(formatToolDetail(t, 'some_unknown_tool').displayText).toBe(
      'Some Unknown Tool',
    );
  });

  it('falls back to the tool display-name when web has no fetch_url input', () => {
    expect(
      formatToolDetail(t, 'web', { operation: 'search' }).displayText,
    ).toBe('Web');
  });
});
