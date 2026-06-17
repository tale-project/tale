/**
 * Property tests for the tiling invariants produced by chunkContent.
 *
 * These guard the load-bearing property that makes reassembly duplicate-free:
 *
 *   (1) chunks.map(c => c.coreContent).join('') === content   (tiling)
 *   (2) content ⊆ coreContent + suffixOverlap (mod whitespace) (embedding)
 *   (3) coreContent.startsWith(prefixOverlap)                  (prefix ⊂ core)
 *   (4) chunks[i].prefixOverlap === chunks[i-1].suffixOverlap  (ordering)
 */

import { describe, expect, it } from 'vitest';

import { chunkContent, type ChunkOptions } from './splitter';

const CONNECTOR_TS_REGRESSION = `const API_BASE = 'https://api.tavily.com';
const MAX_RESULTS_CAP = 5;
const MAX_EXTRACT_URLS = 5;
const MAX_RESULT_CONTENT_CHARS = 2000;

const connector = {
  operations: ['search', 'extract'],

  testConnection: function (ctx) {
    const apiKey = ctx.secrets.get('apiKey');
    if (!apiKey) {
      throw new Error('Tavily API key is required.');
    }
    const response = ctx.http.post(API_BASE + '/search', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query: 'ping', max_results: 1 }),
    });
    return { status: 'ok' };
  },
};

function truncateToChars(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max) + '… [truncated]';
}
`;

const MARKDOWN_WITH_HEADERS = `# Title

Paragraph one. Sentence two. Sentence three.

## Section A

Para A body. More sentences go here, some longer than others.

### Subsection

Short content.

## Section B

Final paragraph with trailing whitespace.
`;

const SINGLE_LONG_LINE = 'abcdefghij'.repeat(500);
const CJK_AND_EMOJI =
  '中文段落一段很长的文字。'.repeat(20) +
  '🔥🎉🚀'.repeat(10) +
  'Mixed English content here '.repeat(10);
const PROSE =
  'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. '.repeat(
    80,
  );
const LEADING_AND_TRAILING_WHITESPACE =
  '   \n\n  Body text with surrounding whitespace.  \n\n   ';
const TRAILING_NEWLINE = 'Content line one.\nContent line two.\n';
const SINGLE_CHAR = 'x';
const EXACTLY_CHUNK_SIZE = 'x'.repeat(2048);

const CORPUS: Record<string, [string, ChunkOptions]> = {
  connector_ts_regression: [CONNECTOR_TS_REGRESSION, {}],
  markdown_with_headers: [MARKDOWN_WITH_HEADERS, {}],
  single_long_line_small_cap: [
    SINGLE_LONG_LINE,
    { chunkSize: 500, chunkOverlap: 50 },
  ],
  cjk_and_emoji: [CJK_AND_EMOJI, { chunkSize: 256, chunkOverlap: 32 }],
  prose: [PROSE, { chunkSize: 300, chunkOverlap: 40 }],
  leading_trailing_ws: [LEADING_AND_TRAILING_WHITESPACE, {}],
  trailing_newline: [TRAILING_NEWLINE, {}],
  single_char: [SINGLE_CHAR, {}],
  exactly_chunk_size: [EXACTLY_CHUNK_SIZE, {}],
};

const names = Object.keys(CORPUS);

describe('tiling invariant (1): cores tile the input exactly', () => {
  it.each(names)('%s', (name) => {
    const [text, opts] = CORPUS[name];
    const chunks = chunkContent(text, opts);
    if (chunks.length === 0) {
      return;
    }
    expect(chunks.map((c) => c.coreContent).join('')).toBe(text);
  });
});

describe('embedding invariant (2): content ⊆ core + suffix (mod whitespace)', () => {
  it.each(names)('%s', (name) => {
    const [text, opts] = CORPUS[name];
    const chunks = chunkContent(text, opts);
    for (const c of chunks) {
      const combined = c.coreContent + c.suffixOverlap;
      const ok =
        combined.includes(c.content) || combined.trim() === c.content.trim();
      expect(ok).toBe(true);
    }
  });
});

describe('invariant (3): prefixOverlap is a prefix of coreContent', () => {
  it.each(names)('%s', (name) => {
    const [text, opts] = CORPUS[name];
    const chunks = chunkContent(text, opts);
    for (const c of chunks) {
      if (c.prefixOverlap) {
        expect(c.coreContent.startsWith(c.prefixOverlap)).toBe(true);
      }
    }
  });
});

describe('invariant (4): prefixOverlap_i === suffixOverlap_{i-1}', () => {
  it.each(names)('%s', (name) => {
    const [text, opts] = CORPUS[name];
    const chunks = chunkContent(text, opts);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i].prefixOverlap).toBe(chunks[i - 1].suffixOverlap);
    }
  });
});

describe('edge invariants', () => {
  it.each(names)('first chunk has no prefix: %s', (name) => {
    const [text, opts] = CORPUS[name];
    const chunks = chunkContent(text, opts);
    if (chunks.length > 0) {
      expect(chunks[0].prefixOverlap).toBe('');
    }
  });

  it.each(names)('last chunk has no suffix: %s', (name) => {
    const [text, opts] = CORPUS[name];
    const chunks = chunkContent(text, opts);
    if (chunks.length > 0) {
      expect(chunks[chunks.length - 1].suffixOverlap).toBe('');
    }
  });
});

describe('determinism and edge cases', () => {
  it('is idempotent across runs', () => {
    const a = chunkContent(PROSE, { chunkSize: 300, chunkOverlap: 40 });
    const b = chunkContent(PROSE, { chunkSize: 300, chunkOverlap: 40 });
    expect(a).toEqual(b);
  });

  it('returns empty for empty/whitespace', () => {
    expect(chunkContent('')).toEqual([]);
    expect(chunkContent(null)).toEqual([]);
    expect(chunkContent('   \n\n\t')).toEqual([]);
  });

  it('preserves leading whitespace in reassembly', () => {
    const text = '   \n\nactual body text that is long enough for the splitter';
    const chunks = chunkContent(text, { chunkSize: 200, chunkOverlap: 20 });
    if (chunks.length > 0) {
      expect(chunks.map((c) => c.coreContent).join('')).toBe(text);
    }
  });

  it('preserves trailing whitespace in reassembly', () => {
    const text = 'actual body text that is long enough for the splitter\n\n   ';
    const chunks = chunkContent(text, { chunkSize: 200, chunkOverlap: 20 });
    if (chunks.length > 0) {
      expect(chunks.map((c) => c.coreContent).join('')).toBe(text);
    }
  });

  it('does not duplicate blocks for the connector regression', () => {
    const chunks = chunkContent(CONNECTOR_TS_REGRESSION, {
      chunkSize: 512,
      chunkOverlap: 100,
    });
    const reassembled = chunks.map((c) => c.coreContent).join('');
    expect(reassembled).toBe(CONNECTOR_TS_REGRESSION);
    const duplicateBlock = "const API_BASE = 'https://api.tavily.com';";
    expect(reassembled.split(duplicateBlock).length - 1).toBe(1);
  });
});
