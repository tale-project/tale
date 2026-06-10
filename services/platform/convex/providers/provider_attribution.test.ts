import { describe, expect, it } from 'vitest';

import {
  interleavedThinkingHeaders,
  providerAttributionHeaders,
  TALE_APP_NAME,
  TALE_APP_URL,
} from './provider_attribution';

const OPENROUTER_HEADERS = {
  'HTTP-Referer': TALE_APP_URL,
  'X-Title': TALE_APP_NAME,
};

describe('providerAttributionHeaders', () => {
  it('attributes OpenRouter by provider name (case-insensitive)', () => {
    expect(
      providerAttributionHeaders({
        providerName: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
    ).toEqual(OPENROUTER_HEADERS);
    expect(
      providerAttributionHeaders({
        providerName: 'OpenRouter',
        baseUrl: 'https://anything.example.com',
      }),
    ).toEqual(OPENROUTER_HEADERS);
  });

  it('attributes OpenRouter by host even when the provider is named differently', () => {
    expect(
      providerAttributionHeaders({
        providerName: 'my-gateway',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
    ).toEqual(OPENROUTER_HEADERS);
    expect(
      providerAttributionHeaders({
        providerName: 'my-gateway',
        baseUrl: 'https://gw.openrouter.ai/api/v1',
      }),
    ).toEqual(OPENROUTER_HEADERS);
  });

  it('sends no headers for direct providers', () => {
    expect(
      providerAttributionHeaders({
        providerName: 'openai',
        baseUrl: 'https://api.openai.com/v1',
      }),
    ).toEqual({});
    expect(
      providerAttributionHeaders({
        providerName: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
      }),
    ).toEqual({});
  });

  it('does not match look-alike hosts (no substring/suffix spoofing)', () => {
    // `.endsWith('.openrouter.ai')` requires the dot-delimited suffix, so a
    // domain that merely embeds the string isn't treated as OpenRouter.
    expect(
      providerAttributionHeaders({
        providerName: 'evil',
        baseUrl: 'https://openrouter.ai.evil.com/v1',
      }),
    ).toEqual({});
    expect(
      providerAttributionHeaders({
        providerName: 'evil',
        baseUrl: 'https://not-openrouter.ai/v1',
      }),
    ).toEqual({});
  });

  it('returns no headers when the base URL is unparseable', () => {
    expect(
      providerAttributionHeaders({
        providerName: 'custom',
        baseUrl: 'not a url',
      }),
    ).toEqual({});
  });
});

describe('interleavedThinkingHeaders', () => {
  it('enables the beta for budgetTokens-knob (Anthropic-style) models', () => {
    expect(
      interleavedThinkingHeaders({
        modelId: 'anthropic/claude-haiku-4.5',
        reasoning: { knob: 'budgetTokens', minBudgetTokens: 1024 },
      }),
    ).toEqual({ 'anthropic-beta': 'interleaved-thinking-2025-05-14' });
  });

  it('sends nothing for effort-knob models', () => {
    expect(
      interleavedThinkingHeaders({
        modelId: 'openai/gpt-5.2',
        reasoning: { knob: 'effort', supportsMinimal: true },
      }),
    ).toEqual({});
  });

  it('sends nothing when reasoning is disabled or undeclared', () => {
    expect(
      interleavedThinkingHeaders({
        modelId: 'deepseek/deepseek-v4-flash',
        reasoning: { knob: 'none' },
      }),
    ).toEqual({});
    expect(interleavedThinkingHeaders({ modelId: 'some/model' })).toEqual({});
  });
});
