import { describe, expect, it } from 'vitest';

import type { ModelCatalogEntry } from '../shared/schemas/providers';
import {
  chooseChatModel,
  eligibleChatCandidates,
  PREFERRED_CHAT_MODELS,
} from './model-choice';

function entry(
  overrides: Partial<ModelCatalogEntry> & { id: string },
): ModelCatalogEntry {
  return {
    provider: 'acme',
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 128_000,
    ...overrides,
  };
}

function priced(
  id: string,
  outputCentsPerMillion: number,
  overrides: Partial<ModelCatalogEntry> = {},
): ModelCatalogEntry {
  return entry({
    id,
    pricing: { inputCentsPerMillion: 10, outputCentsPerMillion },
    ...overrides,
  });
}

function pool(
  entries: readonly ModelCatalogEntry[],
): readonly ModelCatalogEntry[] {
  const result = eligibleChatCandidates(entries, { requiresVision: false });
  if (!('pool' in result))
    throw new Error(`unexpected refusal: ${result.refusal}`);
  return result.pool;
}

describe('eligibleChatCandidates — hazard screen', () => {
  it('keeps only chat-tagged entries', () => {
    const result = pool([
      priced('m-chat', 100),
      entry({ id: 'm-tts', tags: ['text-to-speech'] }),
    ]);
    expect(result.map((e) => e.id)).toEqual(['m-chat']);
  });

  it('drops media generators, :free lanes, and all-zero pricing', () => {
    const result = pool([
      priced('m-real', 100),
      priced('m-media', 0, { outputsMedia: true }),
      priced('m-free-suffix:free', 5),
      entry({
        id: 'm-zero',
        pricing: { inputCentsPerMillion: 0, outputCentsPerMillion: 0 },
      }),
    ]);
    expect(result.map((e) => e.id)).toEqual(['m-real']);
  });

  it('refuses an empty pool as no-chat-model', () => {
    expect(
      eligibleChatCandidates([entry({ id: 'x', tags: ['embedding'] })], {
        requiresVision: false,
      }),
    ).toEqual({ refusal: 'no-chat-model' });
  });

  it('prefers tool-capable entries when any exist', () => {
    const result = pool([
      priced('m-tools', 500),
      priced('m-plain', 5, { supportsTools: false }),
    ]);
    expect(result.map((e) => e.id)).toEqual(['m-tools']);
  });

  it('keeps a tool-less catalog whole (no-signal listings must stay routable)', () => {
    // A plain OpenAI-compatible /models listing cannot declare tool support,
    // so normalization writes supportsTools: false across the board.
    const result = pool([
      priced('vllm-a', 10, { supportsTools: false }),
      priced('vllm-b', 20, { supportsTools: false }),
    ]);
    expect(result.map((e) => e.id)).toEqual(['vllm-a', 'vllm-b']);
  });

  it('narrows to vision models when the message carries images', () => {
    const result = eligibleChatCandidates(
      [
        priced('m-blind', 10),
        priced('m-vision', 100, { supportsVision: true }),
      ],
      { requiresVision: true },
    );
    expect(result).toEqual({
      pool: [expect.objectContaining({ id: 'm-vision' })],
    });
  });

  it('refuses as no-vision-model instead of picking a blind model', () => {
    expect(
      eligibleChatCandidates([priced('m-blind', 10)], { requiresVision: true }),
    ).toEqual({ refusal: 'no-vision-model' });
  });
});

describe('chooseChatModel — curated preference', () => {
  it('picks the target band head when servable', () => {
    const choice = chooseChatModel(
      pool([
        priced('claude-haiku-4-5', 500, { provider: 'anthropic' }),
        priced('claude-sonnet-5', 1000, { provider: 'anthropic' }),
        priced('claude-fable-5', 5000, { provider: 'anthropic' }),
      ]),
      'standard',
    );
    expect(choice).toEqual({
      entry: expect.objectContaining({ id: 'claude-sonnet-5' }),
      source: 'preferred',
    });
  });

  it('matches gateway spellings of a curated id', () => {
    const choice = chooseChatModel(
      pool([
        priced('anthropic/claude-sonnet-5', 1000, { provider: 'openrouter' }),
        priced('z-ai/glm-5.2', 244, { provider: 'openrouter' }),
      ]),
      'standard',
    );
    expect(choice?.entry.id).toBe('anthropic/claude-sonnet-5');
    expect(choice?.source).toBe('preferred');
  });

  it('descends to a weaker band before abandoning the curated list', () => {
    const choice = chooseChatModel(
      pool([
        priced('claude-haiku-4-5', 500, { provider: 'anthropic' }),
        priced('unknown-model', 9000),
      ]),
      'frontier',
    );
    expect(choice?.entry.id).toBe('claude-haiku-4-5');
    expect(choice?.source).toBe('preferred');
  });

  it('never ascends: a draft prompt does not escalate to a frontier pick', () => {
    const choice = chooseChatModel(
      pool([priced('claude-fable-5', 5000, { provider: 'anthropic' })]),
      'draft',
    );
    // The only model wins regardless, but as the price fallback — the
    // curated frontier head must not claim a draft turn.
    expect(choice?.entry.id).toBe('claude-fable-5');
    expect(choice?.source).toBe('cheapest');
  });

  it('keeps the 6x-priced pro tier out of every curated band', () => {
    for (const band of Object.keys(PREFERRED_CHAT_MODELS) as Array<
      keyof typeof PREFERRED_CHAT_MODELS
    >) {
      expect(PREFERRED_CHAT_MODELS[band]).not.toContain('gpt-5.5-pro');
    }
  });

  it('does not prefer the retired deepseek-chat alias', () => {
    expect(PREFERRED_CHAT_MODELS.draft).not.toContain('deepseek-chat');
    expect(PREFERRED_CHAT_MODELS.draft).toContain('deepseek-v4-flash');
  });
});

describe('chooseChatModel — price fallback', () => {
  it('takes the lowest output price among unknown models', () => {
    const choice = chooseChatModel(
      pool([priced('m-a', 300), priced('m-b', 90), priced('m-c', 4000)]),
      'standard',
    );
    expect(choice).toEqual({
      entry: expect.objectContaining({ id: 'm-b' }),
      source: 'cheapest',
    });
  });

  it('sorts unpriced entries last', () => {
    const choice = chooseChatModel(
      pool([entry({ id: 'm-unpriced' }), priced('m-priced', 8000)]),
      'standard',
    );
    expect(choice?.entry.id).toBe('m-priced');
  });

  it('breaks price ties deterministically by (provider, id)', () => {
    const choice = chooseChatModel(
      pool([
        priced('m-same', 100, { provider: 'zeta' }),
        priced('m-same', 100, { provider: 'alpha' }),
        priced('m-later', 100, { provider: 'alpha' }),
      ]),
      'draft',
    );
    expect(choice?.entry.provider).toBe('alpha');
    expect(choice?.entry.id).toBe('m-later');
  });

  it('still resolves an all-unpriced pool', () => {
    const choice = chooseChatModel(
      pool([
        entry({ id: 'b-model', provider: 'beta' }),
        entry({ id: 'a-model', provider: 'beta' }),
      ]),
      'frontier',
    );
    expect(choice).toEqual({
      entry: expect.objectContaining({ id: 'a-model' }),
      source: 'cheapest',
    });
  });

  it('returns null only for an empty pool', () => {
    expect(chooseChatModel([], 'standard')).toBeNull();
  });
});
