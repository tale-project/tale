import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModelCatalogEntry } from '../../../lib/shared/schemas/providers';
import type { ActionCtx } from '../../_generated/server';
import { walkChatCatalog, type ChatCatalogHit } from './chat_catalog';
import { resolveChatModel } from './resolve_chat_model';

vi.mock('./chat_catalog', () => ({
  walkChatCatalog: vi.fn(),
}));

const mockedWalk = vi.mocked(walkChatCatalog);

function entry(args: {
  id: string;
  provider: string;
  vision?: boolean;
  tools?: boolean;
  tags?: string[];
  outputPrice?: number;
}): ModelCatalogEntry {
  return {
    id: args.id,
    provider: args.provider,
    tags: args.tags ?? ['chat'],
    supportsTools: args.tools ?? true,
    supportsVision: args.vision ?? false,
    contextWindow: 100_000,
    ...(args.outputPrice !== undefined && {
      pricing: {
        inputCentsPerMillion: 10,
        outputCentsPerMillion: args.outputPrice,
      },
    }),
  };
}

function hit(e: ModelCatalogEntry): ChatCatalogHit {
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the resolver reads only `name`
    connector: { name: e.provider } as ChatCatalogHit['connector'],
    credential: { providerSlug: e.provider, authMethod: 'api-key' },
    credentialAuth: { authMethod: 'api-key' },
    entry: e,
  };
}

interface GovernanceAnswer {
  defaultModel?: { providerName: string; modelId: string };
  accessible?: string[] | 'all';
}

interface CredentialFacts {
  providerSlug: string;
  authMethod: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker';
}

/** Fake ActionCtx serving the two internal queries the resolver makes:
 * active credential facts, then the governance round trip. */
function fakeCtx(
  credentials: CredentialFacts[],
  governance: GovernanceAnswer = {},
): ActionCtx {
  const runQuery = vi.fn(
    async (_ref: unknown, args: Record<string, unknown>) => {
      if ('supportedModels' in args) {
        const supported = args.supportedModels as string[];
        return {
          defaultModel: governance.defaultModel,
          accessibleModelRefs:
            governance.accessible === undefined ||
            governance.accessible === 'all'
              ? supported
              : governance.accessible,
          explicitAllowed: undefined,
        };
      }
      return credentials;
    },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runQuery is exercised by this module
  return { runQuery } as unknown as ActionCtx;
}

const BASE_ARGS = {
  organizationId: 'org-1',
  userId: 'user-1',
  requiresVision: false,
  hasDocumentAttachments: false,
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('resolveChatModel — sources in order', () => {
  it('routes an everyday prompt to the curated standard pick', async () => {
    mockedWalk.mockResolvedValue(
      [
        entry({
          id: 'claude-haiku-4-5',
          provider: 'anthropic',
          outputPrice: 500,
        }),
        entry({
          id: 'claude-sonnet-5',
          provider: 'anthropic',
          outputPrice: 1000,
        }),
        entry({ id: 'unknown-cheap', provider: 'acme', outputPrice: 5 }),
      ].map(hit),
    );
    const result = await resolveChatModel(
      fakeCtx([{ providerSlug: 'anthropic', authMethod: 'api-key' }]),
      { ...BASE_ARGS, promptText: 'Refactor this function to stream rows.' },
    );
    expect(result).toEqual({
      ok: true,
      pick: {
        providerSlug: 'anthropic',
        modelId: 'claude-sonnet-5',
        source: 'preferred',
        band: 'standard',
        highStakes: false,
        documentWork: false,
      },
    });
  });

  it('floors a short prompt with a document attachment to standard', async () => {
    mockedWalk.mockResolvedValue(
      [
        entry({
          id: 'claude-haiku-4-5',
          provider: 'anthropic',
          outputPrice: 500,
        }),
        entry({
          id: 'claude-sonnet-5',
          provider: 'anthropic',
          outputPrice: 1000,
        }),
      ].map(hit),
    );
    const result = await resolveChatModel(
      fakeCtx([{ providerSlug: 'anthropic', authMethod: 'api-key' }]),
      {
        ...BASE_ARGS,
        // Bandless on its own: without the attachment this lands on draft.
        promptText: 'Fasse mir das Dokument zusammen',
        hasDocumentAttachments: true,
      },
    );
    expect(result).toEqual({
      ok: true,
      pick: {
        providerSlug: 'anthropic',
        modelId: 'claude-sonnet-5',
        source: 'preferred',
        band: 'standard',
        highStakes: false,
        documentWork: true,
      },
    });
  });

  it('lets the default_models pin win over every heuristic', async () => {
    mockedWalk.mockResolvedValue(
      [
        entry({
          id: 'claude-fable-5',
          provider: 'anthropic',
          outputPrice: 5000,
        }),
        entry({
          id: 'claude-haiku-4-5',
          provider: 'anthropic',
          outputPrice: 500,
        }),
      ].map(hit),
    );
    const result = await resolveChatModel(
      fakeCtx([{ providerSlug: 'anthropic', authMethod: 'api-key' }], {
        defaultModel: {
          providerName: 'anthropic',
          modelId: 'claude-haiku-4-5',
        },
      }),
      // A hard prompt: without the pin this would band to frontier.
      { ...BASE_ARGS, promptText: 'Prove and analyze the failure modes here.' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pick.modelId).toBe('claude-haiku-4-5');
      expect(result.pick.source).toBe('pinned');
    }
  });

  it('falls through a pin that is not servable this turn, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedWalk.mockResolvedValue(
      [
        entry({
          id: 'claude-sonnet-5',
          provider: 'anthropic',
          outputPrice: 1000,
        }),
      ].map(hit),
    );
    const result = await resolveChatModel(
      fakeCtx([{ providerSlug: 'anthropic', authMethod: 'api-key' }], {
        defaultModel: { providerName: 'gone', modelId: 'rotated-away' },
      }),
      { ...BASE_ARGS, promptText: 'Refactor the retry loop, please.' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pick.source).toBe('preferred');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to automatic selection'),
    );
  });

  it('falls back to the cheapest model when no curated id is servable', async () => {
    mockedWalk.mockResolvedValue(
      [
        entry({ id: 'vllm-large', provider: 'gateway', outputPrice: 90 }),
        entry({ id: 'vllm-small', provider: 'gateway', outputPrice: 30 }),
        entry({ id: 'vllm-unpriced', provider: 'gateway' }),
      ].map(hit),
    );
    const result = await resolveChatModel(
      fakeCtx([{ providerSlug: 'gateway', authMethod: 'env' }]),
      { ...BASE_ARGS, promptText: 'ok what changed in the last release?' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pick.modelId).toBe('vllm-small');
      expect(result.pick.source).toBe('cheapest');
    }
  });
});

describe('resolveChatModel — candidate world', () => {
  it('walks only direct-capable credentials', async () => {
    mockedWalk.mockResolvedValue(
      [
        entry({
          id: 'claude-sonnet-5',
          provider: 'anthropic',
          outputPrice: 1000,
        }),
      ].map(hit),
    );
    await resolveChatModel(
      fakeCtx([
        { providerSlug: 'anthropic', authMethod: 'api-key' },
        { providerSlug: 'anthropic', authMethod: 'subscription-broker' },
        { providerSlug: 'openai', authMethod: 'subscription-key' },
      ]),
      { ...BASE_ARGS, promptText: 'hi' },
    );
    expect(mockedWalk).toHaveBeenCalledWith(expect.anything(), 'org-1', [
      { providerSlug: 'anthropic', authMethod: 'api-key' },
    ]);
  });

  it('narrows to vision models when the message carries images', async () => {
    mockedWalk.mockResolvedValue(
      [
        entry({
          id: 'claude-haiku-4-5',
          provider: 'anthropic',
          outputPrice: 500,
        }),
        entry({
          id: 'glm-5v-turbo',
          provider: 'zai',
          vision: true,
          outputPrice: 400,
        }),
      ].map(hit),
    );
    const result = await resolveChatModel(
      fakeCtx([
        { providerSlug: 'anthropic', authMethod: 'api-key' },
        { providerSlug: 'zai', authMethod: 'api-key' },
      ]),
      { ...BASE_ARGS, promptText: 'thanks!', requiresVision: true },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pick.modelId).toBe('glm-5v-turbo');
  });

  it('refuses no-vision-model rather than picking a blind model', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedWalk.mockResolvedValue(
      [
        entry({
          id: 'claude-haiku-4-5',
          provider: 'anthropic',
          outputPrice: 500,
        }),
      ].map(hit),
    );
    const result = await resolveChatModel(
      fakeCtx([{ providerSlug: 'anthropic', authMethod: 'api-key' }]),
      { ...BASE_ARGS, promptText: 'describe this image', requiresVision: true },
    );
    expect(result).toEqual({ ok: false, refusal: 'no-vision-model' });
    expect(warn).toHaveBeenCalled();
  });

  it('reports a governance-emptied pool as no-accessible-model', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedWalk.mockResolvedValue(
      [
        entry({
          id: 'claude-sonnet-5',
          provider: 'anthropic',
          outputPrice: 1000,
        }),
      ].map(hit),
    );
    const result = await resolveChatModel(
      fakeCtx([{ providerSlug: 'anthropic', authMethod: 'api-key' }], {
        accessible: [],
      }),
      { ...BASE_ARGS, promptText: 'hello' },
    );
    expect(result).toEqual({ ok: false, refusal: 'no-accessible-model' });
  });

  it('reports an empty catalog as no-chat-model', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedWalk.mockResolvedValue([
      hit(entry({ id: 'a-tts', provider: 'openai', tags: ['text-to-speech'] })),
    ]);
    const result = await resolveChatModel(
      fakeCtx([{ providerSlug: 'openai', authMethod: 'api-key' }]),
      { ...BASE_ARGS, promptText: 'hello' },
    );
    expect(result).toEqual({ ok: false, refusal: 'no-chat-model' });
  });

  it('forces the frontier band on high-stakes ground and says so', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockedWalk.mockResolvedValue(
      [
        entry({
          id: 'claude-fable-5',
          provider: 'anthropic',
          outputPrice: 5000,
        }),
        entry({
          id: 'claude-haiku-4-5',
          provider: 'anthropic',
          outputPrice: 500,
        }),
      ].map(hit),
    );
    const result = await resolveChatModel(
      fakeCtx([{ providerSlug: 'anthropic', authMethod: 'api-key' }]),
      { ...BASE_ARGS, promptText: 'What dosage is safe for this medication?' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pick.modelId).toBe('claude-fable-5');
      expect(result.pick.band).toBe('frontier');
      expect(result.pick.highStakes).toBe(true);
    }
    expect(log).toHaveBeenCalledWith(expect.stringContaining('high-stakes'));
  });
});
