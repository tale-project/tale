// @vitest-environment node

/**
 * The thread-title race: past the wall-clock budget the fallback title wins
 * AND the model call is torn down — a reply nobody can use must not keep the
 * provider working for the client's full request timeout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createBuilderModel,
  directActiveCredential,
  getServableCatalog,
  resolveProvidersForOrgId,
} = vi.hoisted(() => ({
  createBuilderModel: vi.fn(),
  directActiveCredential: vi.fn(),
  getServableCatalog: vi.fn(),
  resolveProvidersForOrgId: vi.fn(),
}));

vi.mock('../automations_builder/model_call', () => ({ createBuilderModel }));
vi.mock('../lib/providers/direct_credential', () => ({
  directActiveCredential,
}));
vi.mock('../lib/providers/org_providers', () => ({ resolveProvidersForOrgId }));
vi.mock('../lib/providers/servable_catalog', () => ({ getServableCatalog }));

import { deriveFallbackTitle } from '../../../lib/chat/derive-fallback-title';
import type { ActionCtx } from '../lib/ctx';
import { generateThreadTitleImpl, TITLE_AGENT_SLUG } from './generate_title';

const FIRST_MESSAGE = 'How do I return a damaged order from last week?';

function fakeCtx(): { ctx: ActionCtx; runMutation: ReturnType<typeof vi.fn> } {
  const runMutation = vi.fn().mockResolvedValue(null);
  const ctx = {
    runQuery: vi.fn().mockResolvedValue(null),
    runMutation,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the naming attempt touches exactly runQuery and runMutation
  return { ctx: ctx as unknown as ActionCtx, runMutation };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resolveProvidersForOrgId.mockResolvedValue([{ name: 'openai' }]);
  directActiveCredential.mockReturnValue({ modelAllowlist: undefined });
  getServableCatalog.mockResolvedValue([{ id: 'gpt-4o-mini' }]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('generateThreadTitleImpl', () => {
  it('aborts the model call when the race is lost and writes the fallback title', async () => {
    let observedSignal: AbortSignal | undefined;
    createBuilderModel.mockImplementation(
      (_ctx: unknown, args: { signal?: AbortSignal }) => {
        observedSignal = args.signal;
        return () =>
          new Promise((_resolve, reject) => {
            args.signal?.addEventListener('abort', () =>
              reject(new Error('openai was unreachable (aborted)')),
            );
          });
      },
    );
    const { ctx, runMutation } = fakeCtx();
    const recordUsage = vi.fn().mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const done = generateThreadTitleImpl(
      ctx,
      {
        organizationId: 'org_1',
        threadId: 'thread_1',
        userId: 'user_1',
        firstMessage: FIRST_MESSAGE,
      },
      recordUsage,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(true);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      threadId: 'thread_1',
      title: deriveFallbackTitle(FIRST_MESSAGE),
    });
    // Nothing was spent: the call never produced usage.
    expect(recordUsage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('aborted after 10000ms'),
    );
  });

  it('books the spend and keeps the signal armed-but-unfired when the model answers in time', async () => {
    let observedSignal: AbortSignal | undefined;
    createBuilderModel.mockImplementation(
      (_ctx: unknown, args: { signal?: AbortSignal }) => {
        observedSignal = args.signal;
        return () =>
          Promise.resolve({
            content: 'Damaged Order Return',
            usage: { prompt: 40, completion: 6 },
          });
      },
    );
    const { ctx, runMutation } = fakeCtx();
    const recordUsage = vi.fn().mockResolvedValue(undefined);

    const done = generateThreadTitleImpl(
      ctx,
      {
        organizationId: 'org_1',
        threadId: 'thread_1',
        userId: 'user_1',
        firstMessage: FIRST_MESSAGE,
      },
      recordUsage,
    );
    await vi.advanceTimersByTimeAsync(0);
    await done;

    expect(observedSignal?.aborted).toBe(false);
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSlug: TITLE_AGENT_SLUG,
        model: 'gpt-4o-mini',
        provider: 'openai',
        inputTokens: 40,
        outputTokens: 6,
        totalTokens: 46,
      }),
    );
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      title: 'Damaged Order Return',
    });
  });
});
