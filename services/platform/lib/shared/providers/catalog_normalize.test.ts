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
      // A Claude gets the named-level knob like every other listing: the
      // OpenAI-compatible body it rides here has no thinking-budget
      // parameter, and declaring one dropped the user's pick from every
      // OpenRouter Claude turn.
      reasoning: { knob: 'effort' },
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

  it('admits explicitly declared transcription, without guessing from audio modalities', () => {
    const audioInput = {
      id: 'example-audio',
      context_window: 448,
      modalities: { input: ['audio'], output: ['text'] },
    };
    expect(
      normalizeCatalogModel({ ...audioInput, type: 'transcription' }, 'p')
        ?.tags,
    ).toEqual(['transcription']);
    expect(normalizeCatalogModel(audioInput, 'p')?.tags).toEqual(['chat']);
    expect(
      normalizeCatalogModel({ ...audioInput, type: 'language' }, 'p')?.tags,
    ).toEqual(['chat']);
    expect(
      normalizeCatalogModel(
        {
          ...audioInput,
          type: 'speech',
          modalities: { input: ['text'], output: ['audio'] },
        },
        'p',
      )?.tags,
    ).not.toContain('transcription');
  });

  it.each([undefined, 0, 128_000])(
    'normalizes OpenRouter pure STT without inventing context or token prices (%s)',
    (context_length) => {
      const entry = normalizeCatalogModel(
        {
          id: 'microsoft/mai-transcribe-2',
          context_length,
          architecture: {
            input_modalities: ['audio'],
            output_modalities: ['transcription'],
          },
          pricing: { prompt: '0.1', completion: '0' },
        },
        'openrouter',
      );
      expect(entry).toEqual({
        id: 'microsoft/mai-transcribe-2',
        provider: 'openrouter',
        tags: ['transcription'],
        supportsTools: false,
        supportsVision: false,
        contextWindow: context_length ?? 0,
      });
    },
  );

  it('keeps pure STT out of chat, vision, tools and reasoning selection', () => {
    const entry = normalizeCatalogModel(
      {
        id: 'explicit-asr',
        type: 'transcription',
        context_window: 0,
        modalities: { input: ['audio', 'image'], output: ['text'] },
        supported_parameters: ['tools', 'reasoning'],
        max_output_tokens: 4096,
        pricing: { input: '0.18', output: '0' },
      },
      'p',
    );
    expect(entry).toEqual({
      id: 'explicit-asr',
      provider: 'p',
      tags: ['transcription'],
      supportsTools: false,
      supportsVision: false,
      contextWindow: 0,
    });
  });

  it.each([
    { modalities: { input: ['audio'], output: ['text'] } },
    {
      architecture: {
        input_modalities: ['audio'],
        output_modalities: ['transcription', 'text'],
      },
    },
    { type: 'embedding' },
    { type: 'embedding', modalities: { output: ['transcription'] } },
    {
      type: 'transcription',
      modalities: { output: ['transcription', 'embeddings'] },
    },
    { type: 'speech', modalities: { input: ['text'], output: ['audio'] } },
    { type: 'transcription', context_window: -1 },
    { type: 'transcription', context_window: 'invalid' },
  ])(
    'does not admit an invalid/non-STT zero context entry (%j)',
    (metadata) => {
      expect(
        normalizeCatalogModel(
          { id: 'unsafe', context_window: 0, ...metadata },
          'p',
        ),
      ).toBeNull();
    },
  );

  it('assumes chat when the source gives no modality or type signal', () => {
    const entry = normalizeCatalogModel({ id: 'm', context_length: 4096 }, 'p');
    expect(entry?.tags).toEqual(['chat']);
    expect(entry?.supportsTools).toBe(false);
    expect(entry?.supportsVision).toBe(false);
  });

  it('marks media generators via outputsMedia and omits it for text-out models', () => {
    // Abridged real entry from OpenRouter `/api/v1/models` (2026-08-04):
    // Lyria is a MUSIC generator, listed image-in/text+audio-out with a 0
    // token price (billing is per clip) — without the outputsMedia fact it
    // reads as the cheapest vision chat model and auto-selection picks it.
    const lyria = normalizeCatalogModel(
      {
        id: 'google/lyria-3-clip-preview',
        context_length: 1_048_576,
        architecture: {
          modality: 'text+image->text+audio',
          input_modalities: ['text', 'image'],
          output_modalities: ['text', 'audio'],
        },
        pricing: { prompt: '0', completion: '0' },
      },
      'openrouter',
    );
    expect(lyria?.outputsMedia).toBe(true);
    expect(lyria?.supportsVision).toBe(true);
    const textOut = normalizeCatalogModel(
      {
        id: 'm',
        context_length: 4096,
        architecture: {
          input_modalities: ['text', 'image'],
          output_modalities: ['text'],
        },
      },
      'p',
    );
    expect(textOut?.outputsMedia).toBeUndefined();
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

describe('normalizeCatalogModel — bare listing entries', () => {
  /** What api.openai.com and most OpenAI-compatible servers publish on
   * `/v1/models`: the id and nothing about the window or the parameters. */
  const BARE = {
    id: 'qwen3-max',
    object: 'model',
    created: 1789726387,
    owned_by: 'system',
  };

  it('drops a bare entry unless a default window is on offer, then reads it as a neutral chat model', () => {
    expect(normalizeCatalogModel(BARE, 'qwen-cn')).toBeNull();
    expect(
      normalizeCatalogModel(BARE, 'qwen-cn', { defaultContextWindow: 128_000 }),
    ).toEqual({
      id: 'qwen3-max',
      provider: 'qwen-cn',
      tags: ['chat'],
      supportsTools: true,
      supportsVision: false,
      contextWindow: 128_000,
    });
  });

  it('keeps a published window and published parameters ahead of the default', () => {
    const published = normalizeCatalogModel(
      {
        ...BARE,
        context_length: 32_000,
        supported_parameters: ['temperature'],
      },
      'qwen-cn',
      { defaultContextWindow: 128_000 },
    );
    expect(published?.contextWindow).toBe(32_000);
    // The listing said which parameters it takes, and tools was not one.
    expect(published?.supportsTools).toBe(false);
    // An explicit zero window is still an absent one for a chat model.
    expect(
      normalizeCatalogModel({ ...BARE, context_length: 0 }, 'qwen-cn', {
        defaultContextWindow: 128_000,
      })?.contextWindow,
    ).toBe(128_000);
  });
});
