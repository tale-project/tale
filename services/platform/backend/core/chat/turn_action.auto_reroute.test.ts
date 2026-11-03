import { modelCatalogEntrySchema } from '@tale/shared/schemas/providers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModelCall } from '../../../lib/chat/turn';
import type { ActionCtx } from '../lib/ctx';
import {
  resolveChatModel,
  type ChatModelPick,
} from '../lib/providers/resolve_chat_model';
import { resolveModel } from '../lib/providers/resolve_model';
import { autoReroute } from './turn_action';

vi.mock('../lib/providers/resolve_chat_model', () => ({
  resolveChatModel: vi.fn(),
}));
vi.mock('../lib/providers/resolve_model', () => ({
  resolveModel: vi.fn(),
}));

const mockedResolveChatModel = vi.mocked(resolveChatModel);
const mockedResolveModel = vi.mocked(resolveModel);

const NEXT = modelCatalogEntrySchema.parse({
  id: 'claude-sonnet-5',
  provider: 'anthropic',
  tags: ['chat'],
  supportsTools: true,
  supportsVision: false,
  contextWindow: 100_000,
});
const PICK: ChatModelPick = {
  providerSlug: 'anthropic',
  modelId: 'claude-sonnet-5',
  source: 'preferred',
  band: 'standard',
  highStakes: false,
};
const ARGS = { organizationId: 'org_1', userId: 'user_1' };
const PROMPT = {
  text: 'Refactor this function to stream rows.',
  hasImages: false,
};
const REFUSED = [
  {
    providerSlug: 'openrouter',
    modelId: 'anthropic/claude-sonnet-5',
    reason: 'The model provider answered 402: requires more credits',
  },
  {
    providerSlug: 'xai',
    modelId: 'grok-4.5',
    reason: 'The model provider answered 429: slow down',
  },
];
const CALL: ModelCall = async function* stream() {
  yield { text: 'Here it is.' };
};
const budgetFor = (entry: { contextWindow: number }) => ({
  maxTokens: entry.contextWindow,
  reserveOutputTokens: 1_000,
});

/** Fake ActionCtx answering the one read the port makes itself: the
 * sender's access to the model it picked. */
function fakeCtx(allowed = true): ActionCtx {
  const runQuery = vi.fn(() =>
    Promise.resolve(
      allowed ? { allowed: true } : { allowed: false, reason: 'Not for you.' },
    ),
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runQuery is exercised by the port
  return { runQuery } as unknown as ActionCtx;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('autoReroute — the next model for a refused Auto turn [CHAT-R36]', () => {
  it('resolves Auto again without the refused providers and serves the pick on its own connector', async () => {
    mockedResolveChatModel.mockResolvedValue({ ok: true, pick: PICK });
    mockedResolveModel.mockResolvedValue({
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the port reads only the connector it hands on
      connector: { name: 'anthropic' } as Awaited<
        ReturnType<typeof resolveModel>
      >['connector'],
      entry: NEXT,
    });
    const ctx = fakeCtx();

    const next = await autoReroute(ctx, ARGS, PROMPT, budgetFor, CALL)(REFUSED);

    expect(mockedResolveChatModel).toHaveBeenCalledWith(ctx, {
      organizationId: 'org_1',
      userId: 'user_1',
      promptText: PROMPT.text,
      requiresVision: false,
      excludeProviders: ['openrouter', 'xai'],
    });
    expect(vi.mocked(ctx).runQuery.mock.calls).toEqual([
      [
        expect.anything(),
        {
          organizationId: 'org_1',
          userId: 'user_1',
          modelId: 'claude-sonnet-5',
        },
      ],
    ]);
    // Strict: no other connector may serve the pick in its place.
    expect(mockedResolveModel).toHaveBeenCalledWith(
      ctx,
      'org_1',
      'claude-sonnet-5',
      'anthropic',
      true,
    );
    expect(next).toEqual({
      model: NEXT,
      budget: { maxTokens: 100_000, reserveOutputTokens: 1_000 },
      call: CALL,
    });
  });

  it('offers nothing when Auto resolves no other model', async () => {
    mockedResolveChatModel.mockResolvedValue({
      ok: false,
      refusal: 'no-chat-model',
    });
    await expect(
      autoReroute(fakeCtx(), ARGS, PROMPT, budgetFor, CALL)(REFUSED),
    ).resolves.toBeUndefined();
    expect(mockedResolveModel).not.toHaveBeenCalled();
  });

  it('offers no model the access policy keeps from the sender', async () => {
    mockedResolveChatModel.mockResolvedValue({ ok: true, pick: PICK });
    await expect(
      autoReroute(fakeCtx(false), ARGS, PROMPT, budgetFor, CALL)(REFUSED),
    ).resolves.toBeUndefined();
    expect(mockedResolveModel).not.toHaveBeenCalled();
  });
});
