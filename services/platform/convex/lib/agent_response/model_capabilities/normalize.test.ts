import { describe, expect, it } from 'vitest';

import { inferPromptCachingMode, inferReasoningKnob } from './infer';
import { normalizeCatalogModel, normalizeCatalogPayload } from './normalize';

describe('normalizeCatalogModel (OpenRouter-shaped entries)', () => {
  it('maps pricing, context, modalities, and supported_parameters', () => {
    const n = normalizeCatalogModel({
      id: 'anthropic/claude-sonnet-4.6',
      name: 'Anthropic: Claude Sonnet 4.6',
      context_length: 200000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
      architecture: {
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
      },
      supported_parameters: ['tools', 'reasoning', 'temperature'],
    });
    expect(n).not.toBeNull();
    // $0.000003/token → 300 cents per million.
    expect(n?.inputCentsPerMillion).toBeCloseTo(300);
    expect(n?.outputCentsPerMillion).toBeCloseTo(1500);
    expect(n?.contextWindow).toBe(200000);
    expect(n?.supportsVision).toBe(true);
    expect(n?.supportsTools).toBe(true);
    // Catalog name → displayName; text output → chat model (for the sync bot).
    expect(n?.displayName).toBe('Anthropic: Claude Sonnet 4.6');
    expect(n?.isChat).toBe(true);
    // Anthropic family → budgetTokens knob.
    expect(n?.reasoning).toMatchObject({ knob: 'budgetTokens' });
    expect(n?.promptCaching).toMatchObject({ mode: 'explicit-breakpoints' });
  });

  it('derives effort knob for a non-Anthropic reasoning model', () => {
    const n = normalizeCatalogModel({
      id: 'openai/gpt-5.2',
      supported_parameters: ['reasoning_effort', 'tools'],
    });
    expect(n?.reasoning).toMatchObject({ knob: 'effort' });
    expect(n?.promptCaching).toMatchObject({ mode: 'auto-server' });
  });

  it('omits reasoning when the source does not report it', () => {
    const n = normalizeCatalogModel({
      id: 'deepseek/deepseek-v4-flash',
      supported_parameters: ['tools', 'temperature'],
    });
    expect(n?.reasoning).toBeUndefined();
    expect(n?.supportsTools).toBe(true);
  });

  it('maps top_provider.max_completion_tokens to maxOutputTokens', () => {
    const n = normalizeCatalogModel({
      id: 'z-ai/glm-5.2',
      context_length: 1048576,
      top_provider: {
        context_length: 101376,
        max_completion_tokens: 101376,
      },
    });
    expect(n?.contextWindow).toBe(1048576);
    expect(n?.maxOutputTokens).toBe(101376);
  });

  it('drops max_completion_tokens that fill the whole context window', () => {
    const n = normalizeCatalogModel({
      id: 'z-ai/glm-5.2',
      context_length: 1048576,
      top_provider: {
        context_length: 1048576,
        max_completion_tokens: 1048576,
      },
    });
    expect(n?.contextWindow).toBe(1048576);
    expect(n?.maxOutputTokens).toBeUndefined();
  });

  it('returns a near-empty entry for sparse {id} payloads (operator config takes precedence later)', () => {
    const n = normalizeCatalogModel({ id: 'gpt-4o' });
    expect(n).toMatchObject({ modelId: 'gpt-4o' });
    expect(n?.inputCentsPerMillion).toBeUndefined();
    expect(n?.supportsTools).toBeUndefined();
  });

  it('returns null for entries without a usable id', () => {
    expect(normalizeCatalogModel({})).toBeNull();
    expect(normalizeCatalogModel({ id: '' })).toBeNull();
    expect(normalizeCatalogModel('nope')).toBeNull();
  });

  it('parses a { data: [...] } payload and drops bad rows', () => {
    const out = normalizeCatalogPayload({
      data: [{ id: 'a/b' }, {}, { id: 'c/d' }],
    });
    expect(out.map((x) => x.modelId)).toEqual(['a/b', 'c/d']);
  });
});

describe('family inference helpers', () => {
  it('infers knobs by family', () => {
    expect(inferReasoningKnob('anthropic/claude-opus-4.6')).toMatchObject({
      knob: 'budgetTokens',
    });
    expect(inferReasoningKnob('x-ai/grok-9')).toMatchObject({ knob: 'effort' });
    expect(inferReasoningKnob('some/unknown-future-model')).toMatchObject({
      knob: 'effort',
    });
  });

  it('infers caching modes by family', () => {
    expect(inferPromptCachingMode('anthropic/claude-x')?.mode).toBe(
      'explicit-breakpoints',
    );
    expect(inferPromptCachingMode('openai/gpt-9')?.mode).toBe('auto-server');
    expect(inferPromptCachingMode('mystery/model')).toBeUndefined();
  });
});
