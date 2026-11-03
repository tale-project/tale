// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isAccessEntryOffered,
  useListProviders,
  useModelCapabilities,
} from './model-catalog';

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
      catalog('deepseek', [
        { id: 'deepseek-v4', tags: ['chat'], supportsTools: true },
      ]),
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
    // The facts the default-model picker screens on ride along.
    expect(deepseek?.models).toEqual([
      {
        id: 'deepseek-v4',
        displayName: 'deepseek-v4',
        tags: ['chat'],
        supportsTools: true,
        outputsMedia: false,
      },
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

  it('says which models each provider with an active credential offers', () => {
    catalogs = [
      catalog('deepseek', [{ id: 'deepseek-v4', tags: ['chat'] }]),
      catalog('zai', [{ id: 'glm-5', tags: ['chat'] }]),
      // No active credential: its models are not offered.
      catalog('anthropic', [{ id: 'claude-fable-5', tags: ['chat'] }]),
    ];
    credentials = [
      credential('deepseek'),
      credential('zai'),
      credential('anthropic', 'disabled'),
    ];
    const { result } = renderHook(() => useListProviders('org-1'));
    expect(result.current.offered).toEqual(
      new Map([
        ['deepseek', new Set(['deepseek-v4'])],
        ['zai', new Set(['glm-5'])],
      ]),
    );
  });

  it('offers nothing when no credential is active', () => {
    catalogs = [catalog('deepseek', [{ id: 'deepseek-v4', tags: ['chat'] }])];
    credentials = [credential('deepseek', 'disabled')];
    const { result } = renderHook(() => useListProviders('org-1'));
    expect(result.current.offered).toEqual(new Map());
  });

  it.each([
    ['the catalogs', () => (catalogs = undefined)],
    ['the credentials', () => (credentials = undefined)],
  ])('does not know what is offered while %s are not read', (_read, unread) => {
    catalogs = [catalog('deepseek', [{ id: 'deepseek-v4', tags: ['chat'] }])];
    credentials = [credential('deepseek')];
    unread();
    const { result } = renderHook(() => useListProviders('org-1'));
    expect(result.current.offered).toBeNull();
  });

  it('does not know what is offered while a configured provider cannot be listed', () => {
    catalogs = [
      catalog('deepseek', [{ id: 'deepseek-v4', tags: ['chat'] }]),
      { ...catalog('zai', []), catalogError: 'listing timed out' },
    ];
    credentials = [credential('deepseek'), credential('zai')];
    const { result } = renderHook(() => useListProviders('org-1'));
    expect(result.current.offered).toBeNull();
  });

  it('knows what is offered when only an unconfigured provider cannot be listed', () => {
    catalogs = [
      catalog('deepseek', [{ id: 'deepseek-v4', tags: ['chat'] }]),
      { ...catalog('zai', []), catalogError: 'listing timed out' },
    ];
    credentials = [credential('deepseek')];
    const { result } = renderHook(() => useListProviders('org-1'));
    expect(result.current.offered).toEqual(
      new Map([['deepseek', new Set(['deepseek-v4'])]]),
    );
  });
});

describe('isAccessEntryOffered', () => {
  const offered = new Map([
    ['openai', new Set(['openai/gpt-4o'])],
    ['proxy', new Set(['proxy:anthropic/claude-sonnet-4', 'openai/gpt-4o'])],
  ]);

  it('finds an entry some provider offers, with or without a qualifier', () => {
    expect(isAccessEntryOffered(offered, 'openai/gpt-4o')).toBe(true);
    expect(isAccessEntryOffered(offered, 'anthropic/claude-sonnet-4')).toBe(
      true,
    );
    expect(isAccessEntryOffered(offered, 'any:openai/gpt-4o')).toBe(true);
  });

  it('does not find an entry no provider offers', () => {
    expect(isAccessEntryOffered(offered, 'mistral/large')).toBe(false);
    expect(isAccessEntryOffered(new Map(), 'openai/gpt-4o')).toBe(false);
  });

  it('leaves out the provider it is told to', () => {
    expect(isAccessEntryOffered(offered, 'openai/gpt-4o', 'openai')).toBe(true);
    expect(
      isAccessEntryOffered(offered, 'anthropic/claude-sonnet-4', 'proxy'),
    ).toBe(false);
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
