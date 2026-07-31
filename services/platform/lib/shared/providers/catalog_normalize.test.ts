import { describe, expect, it } from 'vitest';

import {
  normalizeCatalogModel,
  normalizeCatalogPayload,
} from './catalog_normalize';

/** Abridged real entry from OpenRouter `/api/v1/models` (2026-07-21). */
const OPENROUTER_CLAUDE = {
  id: 'anthropic/claude-sonnet-5',
  name: 'Anthropic: Claude Sonnet 5',
  context_length: 1_000_000,
  architecture: {
    modality: 'text+image+file->text',
    input_modalities: ['text', 'image', 'file'],
    output_modalities: ['text'],
    tokenizer: 'Claude',
  },
  pricing: {
    prompt: '0.000002',
    completion: '0.00001',
    web_search: '0.01',
  },
  top_provider: {
    context_length: 1_000_000,
    max_completion_tokens: 128_000,
    is_moderated: true,
  },
  supported_parameters: [
    'include_reasoning',
    'max_tokens',
    'reasoning',
    'response_format',
    'tool_choice',
    'tools',
  ],
};

/** Abridged real entry from the Vercel AI Gateway `/v1/models` (2026-07-21). */
const VERCEL_QWEN = {
  id: 'alibaba/qwen-3-14b',
  object: 'model',
  owned_by: 'alibaba',
  name: 'Qwen3-14B',
  context_window: 40_960,
  max_tokens: 16_384,
  type: 'language',
  tags: ['reasoning', 'tool-use'],
  modalities: { input: ['text'], output: ['text'] },
  supported_parameters: [
    'max_tokens',
    'temperature',
    'stop',
    'tools',
    'tool_choice',
    'reasoning',
    'include_reasoning',
  ],
  pricing: { input: '0.00000012', output: '0.00000024' },
};

describe('normalizeCatalogModel', () => {
  it('normalizes an OpenRouter entry (dialect A field names)', () => {
    const entry = normalizeCatalogModel(OPENROUTER_CLAUDE, 'openrouter');
    expect(entry).toEqual({
      id: 'anthropic/claude-sonnet-5',
      provider: 'openrouter',
      tags: ['chat', 'vision'],
      supportsTools: true,
      supportsVision: true,
      reasoning: { knob: 'budget-tokens' },
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      // $/token strings × 1e8 → cents per million tokens.
      pricing: { inputCentsPerMillion: 200, outputCentsPerMillion: 1000 },
    });
  });

  it('normalizes a Vercel AI Gateway entry (dialect B field names)', () => {
    const entry = normalizeCatalogModel(VERCEL_QWEN, 'vercel-ai-gateway');
    expect(entry).toEqual({
      id: 'alibaba/qwen-3-14b',
      provider: 'vercel-ai-gateway',
      tags: ['chat'],
      supportsTools: true,
      supportsVision: false,
      // Non-Anthropic family → the openai-style effort parameter.
      reasoning: { knob: 'effort' },
      contextWindow: 40_960,
      maxOutputTokens: 16_384,
      pricing: { inputCentsPerMillion: 12, outputCentsPerMillion: 24 },
    });
  });

  it('drops entries with no id or no positive context window', () => {
    expect(normalizeCatalogModel({ name: 'x' }, 'p')).toBeNull();
    expect(normalizeCatalogModel({ id: '' }, 'p')).toBeNull();
    expect(normalizeCatalogModel({ id: 'm' }, 'p')).toBeNull();
    expect(
      normalizeCatalogModel({ id: 'm', context_length: 0 }, 'p'),
    ).toBeNull();
    expect(normalizeCatalogModel('not-an-object', 'p')).toBeNull();
  });

  it('treats a max output at or above the context window as unreported', () => {
    const entry = normalizeCatalogModel(
      { id: 'm', context_length: 8192, max_output_tokens: 8192 },
      'p',
    );
    expect(entry?.maxOutputTokens).toBeUndefined();
  });

  it('omits reasoning when the source does not report it', () => {
    const entry = normalizeCatalogModel(
      { id: 'm', context_length: 4096, supported_parameters: ['max_tokens'] },
      'p',
    );
    expect(entry?.reasoning).toBeUndefined();
  });

  it('omits pricing unless both sides are reported', () => {
    const entry = normalizeCatalogModel(
      { id: 'm', context_length: 4096, pricing: { input: '0.000001' } },
      'p',
    );
    expect(entry?.pricing).toBeUndefined();
    const free = normalizeCatalogModel(
      { id: 'm', context_length: 4096, pricing: { input: '0', output: '0' } },
      'p',
    );
    expect(free?.pricing).toEqual({
      inputCentsPerMillion: 0,
      outputCentsPerMillion: 0,
    });
  });

  it('tags embedding models as embedding, never chat', () => {
    const byType = normalizeCatalogModel(
      { id: 'e', context_window: 8192, type: 'embedding' },
      'p',
    );
    expect(byType?.tags).toEqual(['embedding']);
    const byModality = normalizeCatalogModel(
      {
        id: 'e2',
        context_window: 8192,
        modalities: { input: ['text'], output: ['embedding'] },
      },
      'p',
    );
    expect(byModality?.tags).toEqual(['embedding']);
    // OpenRouter spells the modality PLURAL — the shape its embeddings
    // listing actually serves (architecture.output_modalities).
    const byPluralModality = normalizeCatalogModel(
      {
        id: 'qwen/qwen3-embedding-8b',
        context_length: 32_768,
        architecture: {
          input_modalities: ['text'],
          output_modalities: ['embeddings'],
        },
      },
      'p',
    );
    expect(byPluralModality?.tags).toEqual(['embedding']);
  });

  it('assumes chat when the source gives no modality or type signal', () => {
    const entry = normalizeCatalogModel({ id: 'm', context_length: 4096 }, 'p');
    expect(entry?.tags).toEqual(['chat']);
    expect(entry?.supportsTools).toBe(false);
    expect(entry?.supportsVision).toBe(false);
  });
});

describe('normalizeCatalogPayload', () => {
  it('reads a { data: [...] } payload and counts drops', () => {
    const { entries, droppedCount } = normalizeCatalogPayload(
      { data: [OPENROUTER_CLAUDE, { id: 'no-context' }, 42] },
      'openrouter',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('anthropic/claude-sonnet-5');
    expect(droppedCount).toBe(2);
  });

  it('reads a bare-array payload', () => {
    const { entries } = normalizeCatalogPayload([VERCEL_QWEN], 'v');
    expect(entries).toHaveLength(1);
  });

  it('deduplicates ids first-wins', () => {
    const { entries, droppedCount } = normalizeCatalogPayload(
      {
        data: [
          { id: 'm', context_length: 1000 },
          { id: 'm', context_length: 2000 },
        ],
      },
      'p',
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.contextWindow).toBe(1000);
    expect(droppedCount).toBe(1);
  });

  it('yields nothing for an unrecognized payload shape', () => {
    expect(normalizeCatalogPayload({ models: [] }, 'p')).toEqual({
      entries: [],
      droppedCount: 0,
    });
    expect(normalizeCatalogPayload(null, 'p').entries).toEqual([]);
  });
});
