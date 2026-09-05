/**
 * Which model names a thread: the owner's sticky chat pick when a direct
 * credential's allowlist admits it, else the first allowlist-permitted
 * catalog model. The allowlist is read through the shared
 * `modelAllowlistPermits` — an allowlist written in one provider id dialect
 * admits the catalog's spelling of the same model, exactly as the picker
 * that offered the model to the owner applied it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { generateThreadTitleImpl } from './generate_title';

const ORG = 'org_a';
const THREAD = 'thread_1';
const USER = 'user_1';

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
