import { describe, expect, it } from 'vitest';

import {
  buildSummaryPrompt,
  buildTranscript,
  extractText,
  formatForSummary,
  summarizeToolResults,
  type SummarizableMessage,
} from './format';

describe('extractText', () => {
  it('returns a string content as-is', () => {
    expect(extractText('hello')).toBe('hello');
  });

  it('joins text parts and ignores non-text parts', () => {
    expect(
      extractText([
        { type: 'text', text: 'a' },
        { type: 'image', image: 'data' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('a\nb');
  });

  it('returns empty string for null/unknown content', () => {
    expect(extractText(null)).toBe('');
    expect(extractText(42)).toBe('');
  });
});

describe('formatForSummary', () => {
  it('role-prefixes user/assistant/system text', () => {
    expect(formatForSummary({ message: { role: 'user', content: 'hi' } })).toBe(
      'User: hi',
    );
    expect(
      formatForSummary({ message: { role: 'assistant', content: 'yo' } }),
    ).toBe('Assistant: yo');
  });

  it('digests tool results so outcomes survive compaction', () => {
    expect(
      formatForSummary({
        message: {
          role: 'tool',
          content: [
            { type: 'tool-result', toolName: 'search', result: 'found 3 rows' },
          ],
        },
      }),
    ).toBe('Tool: search → found 3 rows');
  });

  it('marks tool errors and drops truly-empty content', () => {
    expect(
      formatForSummary({
        message: {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolName: 'db',
              result: 'boom',
              isError: true,
            },
          ],
        },
      }),
    ).toBe('Tool: db (error) → boom');
    expect(formatForSummary({ message: { role: 'tool', content: [] } })).toBe(
      '',
    );
    expect(
      formatForSummary({ message: { role: 'user', content: '   ' } }),
    ).toBe('');
  });
});

describe('summarizeToolResults', () => {
  it('stringifies + truncates object results and joins multiple', () => {
    const long = 'x'.repeat(1000);
    const out = summarizeToolResults([
      { type: 'tool-result', toolName: 'a', output: { k: long } },
      { type: 'text', text: 'ignored' },
      { type: 'tool-result', toolName: 'b', result: 'ok' },
    ]);
    expect(out).toContain('a → ');
    expect(out).toContain('b → ok');
    expect(out.length).toBeLessThan(1000); // truncated
  });

  it('returns empty for non-array / no tool-result content', () => {
    expect(summarizeToolResults('nope')).toBe('');
    expect(summarizeToolResults([{ type: 'text', text: 'x' }])).toBe('');
  });
});

describe('buildTranscript', () => {
  it('formats and joins, skipping empty/tool lines', () => {
    const msgs: SummarizableMessage[] = [
      { message: { role: 'user', content: 'q1' } },
      { message: { role: 'tool', content: 'noise' } },
      { message: { role: 'assistant', content: 'a1' } },
    ];
    expect(buildTranscript(msgs)).toBe('User: q1\nAssistant: a1');
  });
});

describe('buildSummaryPrompt', () => {
  it('omits the prior-summary block on the first compaction', () => {
    const p = buildSummaryPrompt(undefined, 'User: hi');
    expect(p).not.toContain('existing_summary');
    expect(p).toContain('<transcript>');
    expect(p).toContain('User: hi');
  });

  it('folds in a prior running summary hierarchically', () => {
    const p = buildSummaryPrompt('Earlier: user wants X.', 'User: now Y');
    expect(p).toContain('<existing_summary>');
    expect(p).toContain('Earlier: user wants X.');
    expect(p).toContain('User: now Y');
  });
});
