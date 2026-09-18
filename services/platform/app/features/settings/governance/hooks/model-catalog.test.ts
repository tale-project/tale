// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useListProviders, useModelCapabilities } from './model-catalog';

// Mutable, hoisted so the mock factories can read them per test.
let catalogs: unknown = [];
let credentials: unknown = [];

vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
  useProviderCatalogs: () => ({ data: catalogs, isLoading: false }),
  useProviderCredentials: () => ({ data: credentials, isLoading: false }),
}));

function catalog(
  name: string,
  models: Array<{ id: string; tags: string[]; [key: string]: unknown }>,
) {
  return { name, displayName: name.toUpperCase(), models };
}

function credential(providerSlug: string, status = 'active') {
  return { providerSlug, status };
}

beforeEach(() => {
  catalogs = [];
  credentials = [];
});

describe('useListProviders', () => {
  it('lists only the providers the organization has an active credential for', () => {
    catalogs = [
      catalog('deepseek', [{ id: 'deepseek-v4', tags: ['chat'] }]),
      catalog('zai', [{ id: 'glm-5', tags: ['chat'] }]),
      // A shipped provider with no credential must not be offered.
      catalog('anthropic', [{ id: 'claude-fable-5', tags: ['chat'] }]),
    ];
    credentials = [credential('deepseek'), credential('zai')];

    const { result } = renderHook(() => useListProviders('org-1'));
    expect(result.current.providers.map((p) => p.name)).toEqual([
      'deepseek',
      'zai',
    ]);
    const [deepseek] = result.current.providers;
    expect(deepseek?.displayName).toBe('DEEPSEEK');
    expect(deepseek?.models).toEqual([
      { id: 'deepseek-v4', displayName: 'deepseek-v4', tags: ['chat'] },
    ]);
  });

  it('ignores a disabled credential', () => {
    catalogs = [catalog('deepseek', [{ id: 'deepseek-v4', tags: ['chat'] }])];
    credentials = [credential('deepseek', 'disabled')];
    const { result } = renderHook(() => useListProviders('org-1'));
    expect(result.current.providers).toEqual([]);
  });

  it('is empty while the catalog is empty, whatever the credentials', () => {
    catalogs = [];
    credentials = [credential('deepseek')];
    const { result } = renderHook(() => useListProviders('org-1'));
    expect(result.current.providers).toEqual([]);
  });
});

describe('useModelCapabilities', () => {
  it('maps the catalog capabilities for the requested ids and omits the rest', () => {
    catalogs = [
      catalog('deepseek', [
        {
          id: 'deepseek-v4',
          tags: ['chat'],
          contextWindow: 128_000,
          maxOutputTokens: 8_000,
          supportsTools: true,
          supportsVision: false,
          pricing: { inputCentsPerMillion: 14, outputCentsPerMillion: 28 },
          reasoning: { knob: 'effort' },
        },
        { id: 'deepseek-other', tags: ['chat'], contextWindow: 1 },
      ]),
    ];
    const { result } = renderHook(() =>
      useModelCapabilities('org-1', ['deepseek-v4']),
    );
    expect(result.current.get('deepseek-v4')).toEqual({
      contextWindow: 128_000,
      maxOutputTokens: 8_000,
      inputCentsPerMillion: 14,
      outputCentsPerMillion: 28,
      reasoning: { knob: 'effort' },
      supportsTools: true,
      supportsVision: false,
    });
    expect(result.current.has('deepseek-other')).toBe(false);
  });

  it('returns a stable empty map when nothing is requested', () => {
    catalogs = [catalog('deepseek', [{ id: 'deepseek-v4', tags: ['chat'] }])];
    const first = renderHook(() => useModelCapabilities('org-1', []));
    expect(first.result.current.size).toBe(0);
  });
});
