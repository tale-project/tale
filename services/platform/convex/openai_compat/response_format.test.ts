import { describe, expect, it } from 'vitest';

import type { Citation } from './citations';
import {
  buildChatCompletion,
  buildChatCompletionChunk,
  buildChatCompletionWithToolCalls,
  buildStreamingUsageChunk,
  formatSSECitations,
  formatSSEChunk,
  formatSSEDone,
  type OpenAIUsage,
} from './response_format';

describe('buildChatCompletion', () => {
  it('includes citations array when provided', () => {
    const citations: Citation[] = [
      {
        index: 1,
        type: 'rag',
        source: 'report.pdf',
        fileId: 'doc-123',
        page: 42,
        relevance: 0.87,
      },
      {
        index: 2,
        type: 'web',
        source: 'Example Page',
        url: 'https://example.com',
        relevance: 0.72,
      },
    ];

    const result = buildChatCompletion(
      'test-id',
      'my-agent',
      'Response with [1] and [2]',
      1700000000,
      citations,
    );

    expect(result.citations).toEqual(citations);
    expect(result.choices[0].message.content).toBe('Response with [1] and [2]');
  });

  it('includes empty citations array when no citations provided', () => {
    const result = buildChatCompletion(
      'test-id',
      'my-agent',
      'Simple response',
      1700000000,
    );

    expect(result.citations).toEqual([]);
  });

  it('includes empty citations array when explicit empty array provided', () => {
    const result = buildChatCompletion(
      'test-id',
      'my-agent',
      'Response',
      1700000000,
      [],
    );

    expect(result.citations).toEqual([]);
  });

  it('defaults usage to zeros when not provided', () => {
    const result = buildChatCompletion(
      'test-id',
      'my-agent',
      'Response',
      1700000000,
    );

    expect(result.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });

  it('passes through custom usage values', () => {
    const usage: OpenAIUsage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    };

    const result = buildChatCompletion(
      'test-id',
      'my-agent',
      'Response',
      1700000000,
      [],
      usage,
    );

    expect(result.usage).toEqual(usage);
  });
});

describe('buildChatCompletionWithToolCalls', () => {
  const toolCalls = [
    {
      id: 'call_1',
      type: 'function' as const,
      function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
    },
  ];

  it('returns correct structure with tool_calls', () => {
    const result = buildChatCompletionWithToolCalls(
      'test-id',
      'my-agent',
      toolCalls,
      1700000000,
    );

    expect(result.id).toBe('chatcmpl-test-id');
    expect(result.object).toBe('chat.completion');
    expect(result.choices[0].message.role).toBe('assistant');
    expect(result.choices[0].message.tool_calls).toEqual(toolCalls);
    expect(result.choices[0].message.content).toBeNull();
    expect(result.choices[0].finish_reason).toBe('tool_calls');
  });

  it('passes through custom usage values', () => {
    const usage: OpenAIUsage = {
      prompt_tokens: 200,
      completion_tokens: 80,
      total_tokens: 280,
    };

    const result = buildChatCompletionWithToolCalls(
      'test-id',
      'my-agent',
      toolCalls,
      1700000000,
      null,
      usage,
    );

    expect(result.usage).toEqual(usage);
  });

  it('defaults usage to zeros when not provided', () => {
    const result = buildChatCompletionWithToolCalls(
      'test-id',
      'my-agent',
      toolCalls,
      1700000000,
    );

    expect(result.usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });
});

describe('buildChatCompletionChunk', () => {
  it('returns correct chunk structure', () => {
    const result = buildChatCompletionChunk(
      'test-id',
      'my-agent',
      { content: 'hello' },
      null,
      1700000000,
    );

    expect(result.id).toBe('chatcmpl-test-id');
    expect(result.object).toBe('chat.completion.chunk');
    expect(result.choices[0].delta).toEqual({ content: 'hello' });
    expect(result.choices[0].finish_reason).toBeNull();
  });

  it('includes finish_reason on final chunk', () => {
    const result = buildChatCompletionChunk(
      'test-id',
      'my-agent',
      {},
      'stop',
      1700000000,
    );

    expect(result.choices[0].finish_reason).toBe('stop');
  });
});

describe('buildStreamingUsageChunk', () => {
  it('returns chunk with empty choices and populated usage', () => {
    const usage: OpenAIUsage = {
      prompt_tokens: 50,
      completion_tokens: 25,
      total_tokens: 75,
    };

    const result = buildStreamingUsageChunk(
      'test-id',
      'my-agent',
      usage,
      1700000000,
    );

    expect(result.id).toBe('chatcmpl-test-id');
    expect(result.object).toBe('chat.completion.chunk');
    expect(result.choices).toEqual([]);
    expect(result.usage).toEqual(usage);
  });
});

describe('formatSSECitations', () => {
  it('formats citations as an SSE data line', () => {
    const citations: Citation[] = [
      {
        index: 1,
        type: 'rag',
        source: 'report.pdf',
        fileId: 'doc-123',
        relevance: 0.87,
      },
    ];

    const result = formatSSECitations(citations);

    expect(result).toMatch(/^data: /);
    expect(result).toMatch(/\n\n$/);

    const jsonStr = result.replace(/^data: /, '').replace(/\n\n$/, '');
    const parsed = JSON.parse(jsonStr);
    expect(parsed).toEqual({ citations });
  });

  it('produces valid JSON in SSE format', () => {
    const citations: Citation[] = [
      {
        index: 1,
        type: 'rag',
        source: 'report.pdf',
        relevance: 0.9,
      },
      {
        index: 2,
        type: 'web',
        source: 'Web Page',
        url: 'https://example.com',
        relevance: 0.8,
      },
    ];

    const result = formatSSECitations(citations);
    const jsonStr = result.replace(/^data: /, '').replace(/\n\n$/, '');
    const parsed = JSON.parse(jsonStr);

    expect(parsed.citations).toHaveLength(2);
    expect(parsed.citations[0].type).toBe('rag');
    expect(parsed.citations[1].type).toBe('web');
  });
});

describe('SSE format consistency', () => {
  it('formatSSEChunk and formatSSECitations share the same data: prefix pattern', () => {
    const chunk = formatSSEChunk({ test: true });
    const citations = formatSSECitations([]);

    expect(chunk.startsWith('data: ')).toBe(true);
    expect(citations.startsWith('data: ')).toBe(true);
    expect(chunk.endsWith('\n\n')).toBe(true);
    expect(citations.endsWith('\n\n')).toBe(true);
  });

  it('formatSSEDone follows the SSE pattern', () => {
    const done = formatSSEDone();
    expect(done).toBe('data: [DONE]\n\n');
  });
});
