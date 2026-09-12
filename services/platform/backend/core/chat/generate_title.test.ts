// @vitest-environment node

/**
 * Which model names a thread: the owner's sticky chat pick when a direct
 * credential's allowlist admits it, else the first allowlist-permitted
 * catalog model. The allowlist is read through the shared
 * `modelAllowlistPermits` — an allowlist written in one provider id dialect
 * admits the catalog's spelling of the same model, exactly as the picker
 * that offered the model to the owner applied it.
 *
 * And the race: past the wall-clock budget the fallback title wins AND the
 * model call is torn down — a reply nobody can use must not keep the
 * provider working for the client's full request timeout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';

const resolveProvidersMock = vi.fn();
vi.mock('../lib/providers/org_providers', () => ({
  resolveProvidersForOrgId: (...args: unknown[]) =>
    resolveProvidersMock(...(args as [])),
}));

const catalogMock = vi.fn();
vi.mock('../lib/providers/servable_catalog', () => ({
  getServableCatalog: (...args: unknown[]) => catalogMock(...(args as [])),
}));

const createBuilderModelMock = vi.fn();
vi.mock('../automations_builder/model_call', () => ({
  createBuilderModel: (...args: unknown[]) =>
    createBuilderModelMock(...(args as [])),
}));

import { deriveFallbackTitle } from '../../../lib/chat/derive-fallback-title';
import { EmptyReplyError } from '../automations_builder/chat_wire';
import { generateThreadTitleImpl, TITLE_AGENT_SLUG } from './generate_title';

const ORG = 'org_a';
const THREAD = 'thread_1';
const USER = 'user_1';
const FIRST_MESSAGE = 'How do I return a damaged order from last week?';

function provider(name: string) {
  return { name, baseUrl: `https://${name}.example/v1` };
}

function chatEntry(id: string) {
  return { id, tags: ['chat'] };
}

/** A ctx serving the two internal reads (the owner's sticky pick, keyed by
 * `userId`; the provider's default credential row, keyed by `providerSlug`)
 * and capturing the title write. */
function fakeCtx(args: {
  preferredModelId: string | null;
  rows: Record<string, unknown>;
}) {
  const runQuery = vi.fn(
    async (
      _ref: unknown,
      queryArgs: { userId?: string; providerSlug?: string },
    ) =>
      queryArgs.userId !== undefined
        ? args.preferredModelId
        : (args.rows[queryArgs.providerSlug ?? ''] ?? null),
  );
  const runMutation = vi.fn(async () => null);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runQuery/runMutation are exercised by this module
  const ctx = { runQuery, runMutation } as unknown as ActionCtx;
  return { ctx, runMutation };
}

/** An org with one active, direct-capable openai credential serving
 * gpt-4o-mini — the shape every race test starts from. */
function servingCtx() {
  return fakeCtx({
    preferredModelId: 'gpt-4o-mini',
    rows: { openai: { authMethod: 'api-key', status: 'active' } },
  });
}

beforeEach(() => {
  resolveProvidersMock.mockReset();
  catalogMock.mockReset();
  createBuilderModelMock.mockReset();
  resolveProvidersMock.mockResolvedValue([provider('openai')]);
  catalogMock.mockResolvedValue([chatEntry('gpt-5'), chatEntry('gpt-4o-mini')]);
  createBuilderModelMock.mockReturnValue(async () => ({
    content: 'Weekend Plans',
    usage: { prompt: 12, completion: 3 },
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('generateThreadTitleImpl — model choice', () => {
  it("names the thread on the owner's pick when the allowlist admits it across id dialects", async () => {
    // The allowlist names the qualified id; the pick and the catalog carry
    // the bare one — the same model the picker offered the owner.
    const { ctx, runMutation } = fakeCtx({
      preferredModelId: 'gpt-4o-mini',
      rows: {
        openai: {
          authMethod: 'api-key',
          status: 'active',
          modelAllowlist: ['openai/gpt-4o-mini'],
        },
      },
    });

    await generateThreadTitleImpl(ctx, {
      organizationId: ORG,
      threadId: THREAD,
      userId: USER,
      firstMessage: 'What should we do this weekend?',
    });

    expect(createBuilderModelMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        organizationId: ORG,
        target: { providerSlug: 'openai', modelId: 'gpt-4o-mini' },
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: THREAD, title: 'Weekend Plans' }),
    );
  });

  it('falls back to the first allowlist-permitted catalog model when the pick is refused', async () => {
    const { ctx } = fakeCtx({
      preferredModelId: 'gpt-5',
      rows: {
        openai: {
          authMethod: 'api-key',
          status: 'active',
          modelAllowlist: ['openai/gpt-4o-mini'],
        },
      },
    });

    await generateThreadTitleImpl(ctx, {
      organizationId: ORG,
      threadId: THREAD,
      userId: USER,
      firstMessage: 'What should we do this weekend?',
    });

    expect(createBuilderModelMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        target: { providerSlug: 'openai', modelId: 'gpt-4o-mini' },
      }),
    );
  });

  /**
   * A thinking-by-default model (an effort knob with no off literal) spends
   * the title's 48-token budget reasoning and answers nothing — a paid miss
   * on every new thread. A model the wire can run without thinking is
   * preferred: over the owner's pick when the pick thinks, and among the
   * catalog otherwise; only a catalog with nothing else falls back to one.
   */
  it('prefers a model the wire can run without thinking over the owner’s thinking-by-default pick', async () => {
    catalogMock.mockResolvedValue([
      { id: 'glm-5.3', tags: ['chat'], reasoning: { knob: 'effort' } },
      { id: 'glm-5.3-flash', tags: ['chat'], reasoning: { knob: 'effort' } },
      {
        id: 'glm-5.2',
        tags: ['chat'],
        reasoning: { knob: 'effort', off: 'none' },
      },
      { id: 'gpt-4o-mini', tags: ['chat'] },
    ]);
    const { ctx } = fakeCtx({
      preferredModelId: 'glm-5.3',
      rows: { openai: { authMethod: 'api-key', status: 'active' } },
    });
    await generateThreadTitleImpl(ctx, {
      organizationId: ORG,
      threadId: THREAD,
      userId: USER,
      firstMessage: FIRST_MESSAGE,
    });
    // Alphabetically first among the thinking-free: the off-literal model
    // counts as one, the two thinking-by-default ones do not.
    expect(createBuilderModelMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        target: { providerSlug: 'openai', modelId: 'glm-5.2' },
      }),
    );
  });

  it('keeps the owner’s pick when it runs without thinking, and takes a thinking model only when nothing else serves', async () => {
    catalogMock.mockResolvedValue([
      { id: 'glm-5.3', tags: ['chat'], reasoning: { knob: 'effort' } },
      { id: 'gpt-4o-mini', tags: ['chat'] },
    ]);
    const owner = fakeCtx({
      preferredModelId: 'gpt-4o-mini',
      rows: { openai: { authMethod: 'api-key', status: 'active' } },
    });
    await generateThreadTitleImpl(owner.ctx, {
      organizationId: ORG,
      threadId: THREAD,
      userId: USER,
      firstMessage: FIRST_MESSAGE,
    });
    expect(createBuilderModelMock).toHaveBeenLastCalledWith(
      owner.ctx,
      expect.objectContaining({
        target: { providerSlug: 'openai', modelId: 'gpt-4o-mini' },
      }),
    );

    catalogMock.mockResolvedValue([
      { id: 'glm-5.3', tags: ['chat'], reasoning: { knob: 'effort' } },
      { id: 'glm-5.2', tags: ['chat'], reasoning: { knob: 'effort' } },
    ]);
    const thinkingOnly = fakeCtx({
      preferredModelId: 'glm-5.3',
      rows: { openai: { authMethod: 'api-key', status: 'active' } },
    });
    await generateThreadTitleImpl(thinkingOnly.ctx, {
      organizationId: ORG,
      threadId: THREAD,
      userId: USER,
      firstMessage: FIRST_MESSAGE,
    });
    expect(createBuilderModelMock).toHaveBeenLastCalledWith(
      thinkingOnly.ctx,
      expect.objectContaining({
        target: { providerSlug: 'openai', modelId: 'glm-5.3' },
      }),
    );
  });

  it('books the spend of a reply that carried no text, logs one line, and writes the fallback title', async () => {
    createBuilderModelMock.mockReturnValue(() =>
      Promise.reject(new EmptyReplyError({ prompt: 40, completion: 48 })),
    );
    const { ctx, runMutation } = servingCtx();
    const recordUsage = vi.fn().mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await generateThreadTitleImpl(
      ctx,
      {
        organizationId: ORG,
        threadId: THREAD,
        userId: USER,
        firstMessage: FIRST_MESSAGE,
      },
      recordUsage,
    );

    // The call was paid for whether or not a title came back.
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSlug: TITLE_AGENT_SLUG,
        model: 'gpt-4o-mini',
        provider: 'openai',
        inputTokens: 40,
        outputTokens: 48,
        totalTokens: 88,
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: THREAD,
        title: deriveFallbackTitle(FIRST_MESSAGE),
      }),
    );
    // One line naming the model and the counts — never the error object
    // with its stack.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'openai/gpt-4o-mini returned no text (40 in, 48 out)',
      ),
    );
  });

  it('writes the derived fallback title without a model call when no direct credential serves', async () => {
    const { ctx, runMutation } = fakeCtx({
      preferredModelId: 'gpt-5',
      rows: { openai: { authMethod: 'subscription-key', status: 'active' } },
    });

    await generateThreadTitleImpl(ctx, {
      organizationId: ORG,
      threadId: THREAD,
      userId: USER,
      firstMessage: 'What should we do this weekend?',
    });

    expect(createBuilderModelMock).not.toHaveBeenCalled();
    expect(catalogMock).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: THREAD,
        title: expect.stringContaining('weekend'),
      }),
    );
  });
});

describe('generateThreadTitleImpl — the deadline race', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('aborts the model call when the race is lost and writes the fallback title', async () => {
    let observedSignal: AbortSignal | undefined;
    createBuilderModelMock.mockImplementation(
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
    const { ctx, runMutation } = servingCtx();
    const recordUsage = vi.fn().mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const done = generateThreadTitleImpl(
      ctx,
      {
        organizationId: ORG,
        threadId: THREAD,
        userId: USER,
        firstMessage: FIRST_MESSAGE,
      },
      recordUsage,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await done;

    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(true);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: THREAD,
        title: deriveFallbackTitle(FIRST_MESSAGE),
      }),
    );
    // Nothing was spent: the call never produced usage.
    expect(recordUsage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('aborted after 10000ms'),
    );
  });

  it('books the spend and keeps the signal armed-but-unfired when the model answers in time', async () => {
    let observedSignal: AbortSignal | undefined;
    createBuilderModelMock.mockImplementation(
      (_ctx: unknown, args: { signal?: AbortSignal }) => {
        observedSignal = args.signal;
        return () =>
          Promise.resolve({
            content: 'Damaged Order Return',
            usage: { prompt: 40, completion: 6 },
          });
      },
    );
    const { ctx, runMutation } = servingCtx();
    const recordUsage = vi.fn().mockResolvedValue(undefined);

    const done = generateThreadTitleImpl(
      ctx,
      {
        organizationId: ORG,
        threadId: THREAD,
        userId: USER,
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
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: 'Damaged Order Return' }),
    );
  });
});
