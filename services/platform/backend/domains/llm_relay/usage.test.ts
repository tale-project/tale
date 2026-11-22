import { describe, expect, it } from 'vitest';

import {
  costCents,
  foldUsage,
  NO_USAGE,
  usageOfAnswer,
  usageOfEvent,
} from './usage.ts';

describe('what a call used, read off each wire', () => {
  it('reads Anthropic’s cache reads and writes apart from its input', () => {
    const start = usageOfEvent('anthropic', {
      type: 'message_start',
      message: {
        usage: {
          input_tokens: 12,
          cache_read_input_tokens: 4000,
          cache_creation_input_tokens: 300,
          output_tokens: 1,
        },
      },
    });
    const delta = usageOfEvent('anthropic', {
      type: 'message_delta',
      usage: { output_tokens: 250 },
    });
    expect(foldUsage(foldUsage(NO_USAGE, start ?? {}), delta ?? {})).toEqual({
      inputTokens: 12,
      cacheReadTokens: 4000,
      cacheWriteTokens: 300,
      outputTokens: 250,
    });
    expect(usageOfEvent('anthropic', { type: 'ping' })).toBeNull();
  });

  it('reads cached input out of OpenAI’s prompt and input counts', () => {
    expect(
      usageOfEvent('openai-chat', {
        choices: [],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 80,
          prompt_tokens_details: { cached_tokens: 600 },
        },
      }),
    ).toEqual({
      inputTokens: 400,
      cacheReadTokens: 600,
      cacheWriteTokens: 0,
      outputTokens: 80,
    });
    expect(
      usageOfEvent('openai-responses', {
        type: 'response.completed',
        response: {
          usage: {
            input_tokens: 50,
            output_tokens: 7,
            input_tokens_details: { cached_tokens: 10 },
          },
        },
      }),
    ).toEqual({
      inputTokens: 40,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      outputTokens: 7,
    });
    expect(
      usageOfEvent('openai-responses', { type: 'response.output_text.delta' }),
    ).toBeNull();
  });

  it('reads a whole answer’s usage, and nothing from an answer without one', () => {
    expect(
      usageOfAnswer('anthropic', {
        usage: { input_tokens: 3, output_tokens: 9 },
      }),
    ).toEqual({ inputTokens: 3, outputTokens: 9 });
    expect(usageOfAnswer('openai-chat', { choices: [] })).toBeNull();
    expect(usageOfAnswer('openai-chat', 'not json')).toBeNull();
  });

  it('never lets a later report count less than an earlier one', () => {
    expect(
      foldUsage(
        {
          inputTokens: 12,
          cacheReadTokens: 5,
          cacheWriteTokens: 0,
          outputTokens: 40,
        },
        { inputTokens: 0, outputTokens: 30 },
      ),
    ).toEqual({
      inputTokens: 12,
      cacheReadTokens: 5,
      cacheWriteTokens: 0,
      outputTokens: 40,
    });
  });
});

describe('what a call cost', () => {
  const usage = {
    inputTokens: 1_000_000,
    cacheReadTokens: 2_000_000,
    cacheWriteTokens: 1_000_000,
    outputTokens: 500_000,
  };

  it('prices each kind of token at its own catalog price', () => {
    expect(
      costCents(usage, {
        inputCentsPerMillion: 300,
        outputCentsPerMillion: 1500,
        cacheReadCentsPerMillion: 30,
        cacheWriteCentsPerMillion: 375,
      }),
    ).toBe(300 + 60 + 375 + 750);
  });

  it('prices cache reads and writes at the input price where the catalog names none', () => {
    expect(
      costCents(usage, {
        inputCentsPerMillion: 100,
        outputCentsPerMillion: 200,
      }),
    ).toBe(100 + 200 + 100 + 100);
  });

  it('costs nothing for a model the catalog does not price, and rounds to a millionth of a cent', () => {
    expect(costCents(usage, undefined)).toBe(0);
    expect(
      costCents(
        {
          inputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
        },
        { inputCentsPerMillion: 0.3, outputCentsPerMillion: 0 },
      ),
    ).toBe(0);
    expect(
      costCents(
        {
          inputTokens: 7,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 3,
        },
        { inputCentsPerMillion: 300, outputCentsPerMillion: 1500 },
      ),
    ).toBe(0.0066);
  });
});
