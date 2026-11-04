/**
 * A model reaches Anthropic's Messages API on a connector with Anthropic's
 * API format, and as a Claude model behind any connector — the case #5353
 * hit: `anthropic/claude-haiku-5-5` behind an OpenAI-compatible custom
 * provider whose upstream gateway translated the chat call onto Anthropic.
 */

import { describe, expect, it } from 'vitest';

import { servedByAnthropicApi } from './anthropic_api';

describe('servedByAnthropicApi', () => {
  it('flags every model of a connector speaking Anthropic', () => {
    expect(
      servedByAnthropicApi({ apiFormat: 'anthropic' }, 'claude-haiku-5-5'),
    ).toBe(true);
    expect(servedByAnthropicApi({ apiFormat: 'anthropic' }, 'm-1')).toBe(true);
  });

  it.each([
    'anthropic/claude-haiku-5-5',
    '~anthropic/claude-fable-latest',
    'Claude-Opus-5-5',
  ])(
    'flags the Claude model %s behind an OpenAI-compatible connector',
    (id) => {
      expect(servedByAnthropicApi({ apiFormat: 'openai' }, id)).toBe(true);
    },
  );

  it.each(['openai/gpt-6-luna', 'qwen3-coder-plus', 'deepseek-v4'])(
    'leaves the model %s of an OpenAI-compatible connector alone',
    (id) => {
      expect(servedByAnthropicApi({ apiFormat: 'openai' }, id)).toBe(false);
    },
  );
});
