import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../../../../../_generated/server';
import type { LLMNodeConfig } from '../../../../../types';
import { assertChatTag, resolveChatModel } from '../resolve_chat_model';

vi.mock('../../../../../../providers/failover', () => ({
  resolveLanguageModelWithFallback: vi.fn(),
}));

import { resolveLanguageModelWithFallback } from '../../../../../../providers/failover';

const ctx = {} as ActionCtx;
const orgSlug = 'acme';

const baseConfig: LLMNodeConfig = {
  name: 'step',
  systemPrompt: 'sys',
};

const stubResolved = (modelId = 'm', providerName = 'p') => ({
  languageModel: { provider: 'mock' } as never,
  modelData: {
    providerName,
    modelId,
    baseUrl: 'http://example',
    apiKey: 'key',
    tags: ['chat'],
    supportsStructuredOutputs: false,
  },
});

beforeEach(() => {
  vi.mocked(resolveLanguageModelWithFallback).mockReset();
});

describe('resolveChatModel', () => {
  it('falls back to tag-based resolution with failover when model is unset', async () => {
    vi.mocked(resolveLanguageModelWithFallback).mockResolvedValue(
      stubResolved(),
    );
    await resolveChatModel(ctx, baseConfig, orgSlug);
    expect(resolveLanguageModelWithFallback).toHaveBeenCalledWith(ctx, {
      tag: 'chat',
      orgSlug,
    });
  });

  it('routes a qualified explicit model ref through the failover resolver', async () => {
    vi.mocked(resolveLanguageModelWithFallback).mockResolvedValue(
      stubResolved('claude-haiku-4.5', 'openrouter'),
    );
    await resolveChatModel(
      ctx,
      { ...baseConfig, model: 'openrouter:anthropic/claude-haiku-4.5' },
      orgSlug,
    );
    expect(resolveLanguageModelWithFallback).toHaveBeenCalledWith(ctx, {
      modelId: 'anthropic/claude-haiku-4.5',
      providerName: 'openrouter',
      tag: 'chat',
      orgSlug,
    });
  });

  it('routes an unqualified explicit model ref (no provider) through the failover resolver', async () => {
    vi.mocked(resolveLanguageModelWithFallback).mockResolvedValue(
      stubResolved(),
    );
    await resolveChatModel(ctx, { ...baseConfig, model: 'gpt-5.2' }, orgSlug);
    expect(resolveLanguageModelWithFallback).toHaveBeenCalledWith(ctx, {
      modelId: 'gpt-5.2',
      providerName: undefined,
      tag: 'chat',
      orgSlug,
    });
  });

  it('treats whitespace-only model as unset', async () => {
    vi.mocked(resolveLanguageModelWithFallback).mockResolvedValue(
      stubResolved(),
    );
    await resolveChatModel(ctx, { ...baseConfig, model: '   ' }, orgSlug);
    expect(resolveLanguageModelWithFallback).toHaveBeenCalledWith(ctx, {
      tag: 'chat',
      orgSlug,
    });
  });

  it('trims surrounding whitespace from explicit refs before parsing', async () => {
    vi.mocked(resolveLanguageModelWithFallback).mockResolvedValue(
      stubResolved(),
    );
    await resolveChatModel(
      ctx,
      { ...baseConfig, model: '  openrouter:foo  ' },
      orgSlug,
    );
    expect(resolveLanguageModelWithFallback).toHaveBeenCalledWith(ctx, {
      modelId: 'foo',
      providerName: 'openrouter',
      tag: 'chat',
      orgSlug,
    });
  });
});

describe('assertChatTag', () => {
  const modelData = (tags: string[]) => ({
    providerName: 'openrouter',
    modelId: 'foo/bar',
    baseUrl: 'http://x',
    apiKey: 'k',
    tags,
    supportsStructuredOutputs: false,
  });

  it('returns silently when the resolved model carries the chat tag', () => {
    expect(() =>
      assertChatTag(modelData(['chat', 'vision']), undefined),
    ).not.toThrow();
  });

  it('throws INVALID_MODEL_FOR_LLM_STEP for non-chat models', () => {
    let caught: unknown;
    try {
      assertChatTag(modelData(['embedding']), 'openrouter:foo/bar');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    const data = (caught as ConvexError<{ code: string; message: string }>)
      .data;
    expect(data.code).toBe('INVALID_MODEL_FOR_LLM_STEP');
    expect(data.message).toContain('openrouter:foo/bar');
    expect(data.message).toContain('not tagged as a chat model');
  });

  it('omits the requested ref from the message when none was provided', () => {
    let caught: unknown;
    try {
      assertChatTag(modelData(['transcription']), undefined);
    } catch (err) {
      caught = err;
    }
    const data = (caught as ConvexError<{ message: string }>).data;
    expect(data.message).toContain('openrouter:foo/bar');
    expect(data.message).not.toContain('resolved to');
  });
});
