/**
 * Picking Gemini 2.5 Flash Image in the chat composer failed every message
 * with OpenRouter's 404 "No endpoints found that support tool use. Try
 * disabling "rag_search"": the listing tags an image generator that also
 * writes text `chat`, and the composer offered it. The entries below are
 * OpenRouter's listing rows as published on 2026-10-28, normalized the way
 * the catalog reads them.
 */

import { describe, expect, it } from 'vitest';

import { normalizeCatalogModel } from './catalog_normalize';
import { answersChatTurns } from './chat_turn_models';

function openRouterEntry(
  id: string,
  outputModalities: string[],
  supportedParameters: string[],
) {
  const entry = normalizeCatalogModel(
    {
      id,
      context_length: 32_768,
      architecture: {
        input_modalities: ['text', 'image'],
        output_modalities: outputModalities,
      },
      supported_parameters: supportedParameters,
      pricing: { prompt: '0.0000003', completion: '0.0000025' },
    },
    'openrouter',
  );
  if (entry === null) throw new Error(`${id} did not normalize`);
  return entry;
}

describe('answersChatTurns', () => {
  it('admits a chat model that takes tools', () => {
    const entry = openRouterEntry(
      'anthropic/claude-haiku-4.5',
      ['text'],
      ['max_tokens', 'tools', 'tool_choice'],
    );
    expect(answersChatTurns(entry)).toBe(true);
  });

  it('refuses an image generator that writes text but takes no tools', () => {
    const entry = openRouterEntry(
      'google/gemini-2.5-flash-image',
      ['image', 'text'],
      ['max_tokens', 'response_format', 'seed', 'temperature'],
    );
    expect(entry.tags).toContain('chat');
    expect(answersChatTurns(entry)).toBe(false);
  });

  it('admits an image-capable model that takes tools, such as OpenRouter Auto', () => {
    const entry = openRouterEntry(
      'openrouter/auto',
      ['text', 'image'],
      ['max_tokens', 'tools', 'tool_choice'],
    );
    expect(answersChatTurns(entry)).toBe(true);
  });

  it('refuses an image generator that writes no text', () => {
    const entry = openRouterEntry(
      'openai/gpt-image-2.5-sunburst',
      ['image'],
      ['max_tokens', 'response_format', 'seed'],
    );
    expect(answersChatTurns(entry)).toBe(false);
  });
});
