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

  describe('external-agent (Claude Code) tools', () => {
    it('surfaces the Bash command', () => {
      expect(
        formatToolDetail(t, 'Bash', { command: 'gh pr diff 1875' }).displayText,
      ).toBe('Bash · gh pr diff 1875');
    });

    it('surfaces the file path for Read/Edit/Write', () => {
      expect(
        formatToolDetail(t, 'Read', { file_path: '/repo/a.ts' }).displayText,
      ).toBe('Read · /repo/a.ts');
      expect(
        formatToolDetail(t, 'Edit', { file_path: '/repo/b.ts' }).displayText,
      ).toBe('Edit · /repo/b.ts');
    });

    it('surfaces the Grep/Glob pattern and WebFetch host', () => {
      expect(formatToolDetail(t, 'Grep', { pattern: 'TODO' }).displayText).toBe(
        'Grep · TODO',
      );
      expect(
        formatToolDetail(t, 'WebFetch', { url: 'https://x.com/y' }).displayText,
      ).toBe('WebFetch · x.com');
    });

    it('truncates a long Bash command', () => {
      const cmd = 'echo ' + 'a'.repeat(200);
      const out = formatToolDetail(t, 'Bash', { command: cmd }).displayText;
      expect(out.startsWith('Bash · echo ')).toBe(true);
      expect(out.endsWith('…')).toBe(true);
    });

    it('falls back to the title-cased name when the arg is absent', () => {
      expect(formatToolDetail(t, 'Bash', {}).displayText).toBe('Bash');
    });
  });

  describe('MCP tools (mcp__server__tool)', () => {
    it('surfaces the integration slug for the dispatch tool', () => {
      expect(
        formatToolDetail(t, 'mcp__integrations__integration', {
          slug: 'tavily',
          operation: 'search',
        }).displayText,
      ).toBe('Integration · Tavily');
    });

    it('labels the dispatch tool plainly when no slug is given', () => {
      expect(
        formatToolDetail(t, 'mcp__integrations__integration', {}).displayText,
      ).toBe('Integration');
    });

    it('labels the status tool even with no arguments', () => {
      expect(
        formatToolDetail(t, 'mcp__integrations__integration_status')
          .displayText,
      ).toBe('Integration status');
    });

    it('cleanly humanizes other MCP tools without the mcp/server prefix', () => {
      expect(
        formatToolDetail(t, 'mcp__playwright__browser_navigate').displayText,
      ).toBe('Browser Navigate');
    });
  });
});
