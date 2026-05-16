import { describe, expect, it } from 'vitest';

import {
  expandModelVariants,
  getVariantBadgeLabel,
} from './expand-model-variants';

const QUANTS: Record<string, string[]> = {
  'z-ai/glm-5.1': ['fp8', 'fp4'],
  'deepseek/deepseek-v4-pro': ['fp8', 'fp4'],
};
const lookup = (id: string): string[] | undefined => QUANTS[id];

describe('expandModelVariants', () => {
  it('returns an empty array when given an empty input', () => {
    expect(expandModelVariants([], lookup)).toEqual([]);
  });

  it('keeps a model with no quantizations unchanged', () => {
    expect(
      expandModelVariants(['openrouter:anthropic/claude-opus-4.6'], lookup),
    ).toEqual(['openrouter:anthropic/claude-opus-4.6']);
  });

  it('expands a base ref into one entry per quantization in declared order', () => {
    expect(expandModelVariants(['openrouter:z-ai/glm-5.1'], lookup)).toEqual([
      'openrouter:z-ai/glm-5.1@fp8',
      'openrouter:z-ai/glm-5.1@fp4',
    ]);
  });

  it('keeps an already-pinned variant ref verbatim (no re-expansion)', () => {
    expect(
      expandModelVariants(['openrouter:z-ai/glm-5.1@fp4'], lookup),
    ).toEqual(['openrouter:z-ai/glm-5.1@fp4']);
  });

  it('dedupes two identical pinned-variant refs', () => {
    expect(
      expandModelVariants(
        ['openrouter:z-ai/glm-5.1@fp8', 'openrouter:z-ai/glm-5.1@fp8'],
        lookup,
      ),
    ).toEqual(['openrouter:z-ai/glm-5.1@fp8']);
  });

  it('preserves order when two distinct pinned variants of the same base are given', () => {
    expect(
      expandModelVariants(
        ['openrouter:z-ai/glm-5.1@fp4', 'openrouter:z-ai/glm-5.1@fp8'],
        lookup,
      ),
    ).toEqual(['openrouter:z-ai/glm-5.1@fp4', 'openrouter:z-ai/glm-5.1@fp8']);
  });

  it('dedupes when input mixes a base ref with one of its variants', () => {
    expect(
      expandModelVariants(
        ['openrouter:z-ai/glm-5.1@fp8', 'openrouter:z-ai/glm-5.1'],
        lookup,
      ),
    ).toEqual(['openrouter:z-ai/glm-5.1@fp8', 'openrouter:z-ai/glm-5.1@fp4']);
  });

  it('dedupes duplicate base refs', () => {
    expect(
      expandModelVariants(
        ['openrouter:z-ai/glm-5.1', 'openrouter:z-ai/glm-5.1'],
        lookup,
      ),
    ).toEqual(['openrouter:z-ai/glm-5.1@fp8', 'openrouter:z-ai/glm-5.1@fp4']);
  });

  it('treats an empty quantizations array as no-variant', () => {
    expect(
      expandModelVariants(['openrouter:foo/bar'], (id) =>
        id === 'foo/bar' ? [] : undefined,
      ),
    ).toEqual(['openrouter:foo/bar']);
  });

  it('preserves the missing provider prefix when expanding unqualified refs', () => {
    expect(expandModelVariants(['z-ai/glm-5.1'], lookup)).toEqual([
      'z-ai/glm-5.1@fp8',
      'z-ai/glm-5.1@fp4',
    ]);
  });

  it('keeps unknown bare ids as-is', () => {
    expect(expandModelVariants(['openrouter:unknown/model'], lookup)).toEqual([
      'openrouter:unknown/model',
    ]);
  });

  it('handles multiple distinct models in one input list', () => {
    expect(
      expandModelVariants(
        [
          'openrouter:z-ai/glm-5.1',
          'openrouter:anthropic/claude-opus-4.6',
          'openrouter:deepseek/deepseek-v4-pro@fp4',
        ],
        lookup,
      ),
    ).toEqual([
      'openrouter:z-ai/glm-5.1@fp8',
      'openrouter:z-ai/glm-5.1@fp4',
      'openrouter:anthropic/claude-opus-4.6',
      'openrouter:deepseek/deepseek-v4-pro@fp4',
    ]);
  });
});

describe('getVariantBadgeLabel', () => {
  it('uppercases the token', () => {
    expect(getVariantBadgeLabel('fp8')).toBe('FP8');
    expect(getVariantBadgeLabel('bf16')).toBe('BF16');
    expect(getVariantBadgeLabel('int8')).toBe('INT8');
  });
});
