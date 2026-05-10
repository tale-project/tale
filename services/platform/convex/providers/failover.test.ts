import type { LanguageModelV3 } from '@ai-sdk/provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./circuit_breaker', () => ({
  isOpen: vi.fn(() => false),
}));

vi.mock('./resolve_model', () => ({
  resolveLanguageModelById: vi.fn(),
  resolveLanguageModel: vi.fn(),
}));

import { isOpen } from './circuit_breaker';
import { resolveLanguageModelWithFallback } from './failover';
import {
  resolveLanguageModel,
  resolveLanguageModelById,
} from './resolve_model';

const mockedById = vi.mocked(resolveLanguageModelById);
const mockedByTag = vi.mocked(resolveLanguageModel);
const mockedIsOpen = vi.mocked(isOpen);

const fakeCtx = {} as Parameters<typeof resolveLanguageModelWithFallback>[0];

function fakeResolved(label: string) {
  return {
    languageModel: { modelId: label } as unknown as LanguageModelV3,
    modelData: {
      providerName: 'test',
      apiKey: 'k',
      baseUrl: 'https://example.com',
      modelId: label,
    } as unknown as Parameters<
      typeof resolveLanguageModelWithFallback
    >[1] extends infer _
      ? never
      : never,
  };
}

describe('resolveLanguageModelWithFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsOpen.mockReturnValue(false);
  });

  it('returns primary on first attempt', async () => {
    mockedById.mockResolvedValueOnce(
      fakeResolved('primary') as unknown as Awaited<
        ReturnType<typeof resolveLanguageModelById>
      >,
    );
    const out = await resolveLanguageModelWithFallback(fakeCtx, {
      modelId: 'gpt-4',
      providerName: 'openai',
      tag: 'chat',
      fallbackModelId: 'haiku',
      fallbackProviderName: 'anthropic',
    });
    expect(out.languageModel.modelId).toBe('primary');
    expect(mockedById).toHaveBeenCalledTimes(1);
    expect(mockedByTag).not.toHaveBeenCalled();
  });

  it('falls through to fallbackModelId on primary failure', async () => {
    mockedById
      .mockRejectedValueOnce(new Error('primary down'))
      .mockResolvedValueOnce(
        fakeResolved('fallback') as unknown as Awaited<
          ReturnType<typeof resolveLanguageModelById>
        >,
      );
    const out = await resolveLanguageModelWithFallback(fakeCtx, {
      modelId: 'gpt-4',
      providerName: 'openai',
      fallbackModelId: 'haiku',
      fallbackProviderName: 'anthropic',
    });
    expect(out.languageModel.modelId).toBe('fallback');
    expect(mockedById).toHaveBeenCalledTimes(2);
  });

  it('reaches Attempt 3 (fallback-provider tag search) only when fallbackProviderName differs from primary', async () => {
    mockedById
      .mockRejectedValueOnce(new Error('primary down'))
      .mockRejectedValueOnce(new Error('fallback model down'));
    mockedByTag.mockResolvedValueOnce(
      fakeResolved('attempt3') as unknown as Awaited<
        ReturnType<typeof resolveLanguageModel>
      >,
    );

    const out = await resolveLanguageModelWithFallback(fakeCtx, {
      modelId: 'gpt-4',
      providerName: 'openai',
      tag: 'chat',
      fallbackModelId: 'haiku',
      fallbackProviderName: 'anthropic',
    });
    expect(out.languageModel.modelId).toBe('attempt3');
    expect(mockedByTag).toHaveBeenCalledWith(
      fakeCtx,
      expect.objectContaining({ tag: 'chat', providerName: 'anthropic' }),
    );
  });

  it('reaches Attempt 4 (any-provider tag search) when first three fail', async () => {
    mockedById
      .mockRejectedValueOnce(new Error('a1'))
      .mockRejectedValueOnce(new Error('a2'));
    mockedByTag
      .mockRejectedValueOnce(new Error('a3'))
      .mockResolvedValueOnce(
        fakeResolved('attempt4') as unknown as Awaited<
          ReturnType<typeof resolveLanguageModel>
        >,
      );

    const out = await resolveLanguageModelWithFallback(fakeCtx, {
      modelId: 'gpt-4',
      providerName: 'openai',
      tag: 'chat',
      fallbackModelId: 'haiku',
      fallbackProviderName: 'anthropic',
    });
    expect(out.languageModel.modelId).toBe('attempt4');
    // last call: any provider, same tag
    const lastCall = mockedByTag.mock.calls.at(-1)?.[1];
    expect(lastCall).toMatchObject({ tag: 'chat' });
    expect(lastCall?.providerName).toBeUndefined();
  });

  it('throws lastError when all attempts fail', async () => {
    mockedById
      .mockRejectedValueOnce(new Error('a1'))
      .mockRejectedValueOnce(new Error('a2'));
    mockedByTag
      .mockRejectedValueOnce(new Error('a3'))
      .mockRejectedValueOnce(new Error('final boss'));

    await expect(
      resolveLanguageModelWithFallback(fakeCtx, {
        modelId: 'gpt-4',
        providerName: 'openai',
        tag: 'chat',
        fallbackModelId: 'haiku',
        fallbackProviderName: 'anthropic',
      }),
    ).rejects.toThrow('final boss');
  });

  it('skips primary when circuit breaker is open', async () => {
    mockedIsOpen.mockReturnValue(true);
    mockedById.mockResolvedValueOnce(
      fakeResolved('fallback') as unknown as Awaited<
        ReturnType<typeof resolveLanguageModelById>
      >,
    );
    const out = await resolveLanguageModelWithFallback(fakeCtx, {
      modelId: 'gpt-4',
      providerName: 'openai',
      fallbackModelId: 'haiku',
    });
    expect(out.languageModel.modelId).toBe('fallback');
    // First call should be the fallback model, not the primary.
    expect(mockedById.mock.calls[0][1]).toMatchObject({ modelId: 'haiku' });
  });

  it('does NOT add Attempt 3 when fallbackProviderName equals primary', async () => {
    mockedById
      .mockRejectedValueOnce(new Error('a1'))
      .mockRejectedValueOnce(new Error('a2'));
    mockedByTag.mockResolvedValueOnce(
      fakeResolved('attempt4') as unknown as Awaited<
        ReturnType<typeof resolveLanguageModel>
      >,
    );

    const out = await resolveLanguageModelWithFallback(fakeCtx, {
      modelId: 'gpt-4',
      providerName: 'openai',
      tag: 'chat',
      fallbackModelId: 'gpt-3.5',
      fallbackProviderName: 'openai',
    });
    expect(out.languageModel.modelId).toBe('attempt4');
    // Only one tag search (Attempt 4 broad), no Attempt 3 same-provider tag search.
    expect(mockedByTag).toHaveBeenCalledTimes(1);
  });

  it('produces 4 distinct dedup keys for fully-configured failover', async () => {
    mockedById
      .mockRejectedValue(new Error('always fail'))
      .mockRejectedValue(new Error('always fail'));
    mockedByTag.mockRejectedValue(new Error('always fail'));

    await expect(
      resolveLanguageModelWithFallback(fakeCtx, {
        modelId: 'gpt-4',
        providerName: 'openai',
        tag: 'chat',
        fallbackModelId: 'haiku',
        fallbackProviderName: 'anthropic',
      }),
    ).rejects.toThrow();

    // 2 ById calls (Attempts 1 & 2) + 2 ByTag calls (Attempts 3 & 4).
    expect(mockedById).toHaveBeenCalledTimes(2);
    expect(mockedByTag).toHaveBeenCalledTimes(2);
  });
});
