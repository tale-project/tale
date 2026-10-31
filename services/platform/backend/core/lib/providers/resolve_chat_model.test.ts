import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../../lib/shared/handlers/function-refs';
import type { ActionCtx } from '../ctx';
import { walkChatCatalog, type ChatCatalogHit } from './chat_catalog';
import { resolveChatModel } from './resolve_chat_model';

// The walk is faked; the EU/EEA filter over its hits stays the real one.
vi.mock('./chat_catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./chat_catalog')>()),
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

/** A catalog hit whose credential names its own endpoint, the one the
 * EU/EEA rule judges (the connector names none here). */
function hitAt(e: ModelCatalogEntry, endpointUrl: string): ChatCatalogHit {
  const base = hit(e);
  return { ...base, credential: { ...base.credential, endpointUrl } };
}

interface GovernanceAnswer {
  defaultModel?: { providerName: string; modelId: string };
  accessible?: string[] | 'all';
  /** The EU/EEA processing rule the seam answers; open when not given. */
  endpointPolicy?: unknown;
}

interface CredentialFacts {
  providerSlug: string;
  authMethod: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker';
}

/** Fake ActionCtx serving the internal queries the resolver makes: active
 * credential facts, the EU/EEA processing rule, then the governance round
 * trip. */
function fakeCtx(
  credentials: CredentialFacts[],
  governance: GovernanceAnswer = {},
): ActionCtx {
  const runQuery = vi.fn(
    async (ref: unknown, args: Record<string, unknown>) => {
      if (
        functionRefName(ref) ===
        'governance/internal_queries:getModelEndpointPolicyInternal'
      ) {
        return governance.endpointPolicy ?? { kind: 'open' };
      }
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
      },
    });
  });

  it('routes a short ask about a document by its text alone', async () => {
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
      // An attached document does not move the band: the text does.
      { ...BASE_ARGS, promptText: 'Fasse mir das Dokument zusammen' },
    );
    expect(result).toEqual({
      ok: true,
      pick: {
        providerSlug: 'anthropic',
        modelId: 'claude-haiku-4-5',
        source: 'preferred',
        band: 'draft',
        highStakes: false,
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

describe('resolveChatModel — the EU/EEA processing rule [GOV-R22]', () => {
  const ANTHROPIC = {
    providerSlug: 'anthropic',
    authMethod: 'api-key',
  } as const;
  const OPENAI = { providerSlug: 'openai', authMethod: 'api-key' } as const;

  function world() {
    return [
      hit(
        entry({
          id: 'claude-haiku-4-5',
          provider: 'anthropic',
          outputPrice: 500,
        }),
      ),
      hitAt(
        entry({ id: 'gpt-5-mini', provider: 'openai', outputPrice: 200 }),
        'https://eu.api.openai.com/v1',
      ),
    ];
  }

  it('picks among the models the rule lets through, and only then', async () => {
    mockedWalk.mockResolvedValue(world());
    const open = await resolveChatModel(fakeCtx([ANTHROPIC, OPENAI]), {
      ...BASE_ARGS,
      promptText: 'Refactor this function to stream rows.',
    });
    expect(open.ok && open.pick.providerSlug).toBe('anthropic');

    mockedWalk.mockResolvedValue(world());
    const eu = await resolveChatModel(
      fakeCtx([ANTHROPIC, OPENAI], {
        endpointPolicy: { kind: 'eu', attestedHosts: [] },
      }),
      { ...BASE_ARGS, promptText: 'Refactor this function to stream rows.' },
    );
    expect(eu).toMatchObject({
      ok: true,
      pick: { providerSlug: 'openai', modelId: 'gpt-5-mini' },
    });
  });

  it('falls through a pin the rule refuses rather than calling it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedWalk.mockResolvedValue(world());
    const result = await resolveChatModel(
      fakeCtx([ANTHROPIC, OPENAI], {
        defaultModel: {
          providerName: 'anthropic',
          modelId: 'claude-haiku-4-5',
        },
        endpointPolicy: { kind: 'eu', attestedHosts: [] },
      }),
      { ...BASE_ARGS, promptText: 'Hello there.' },
    );
    expect(result).toMatchObject({
      ok: true,
      pick: { providerSlug: 'openai', modelId: 'gpt-5-mini' },
    });
  });

  it('says no-eu-model when the rule leaves no chat model, and model-policy-unreadable when it cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedWalk.mockResolvedValue([world()[0]!]);
    await expect(
      resolveChatModel(
        fakeCtx([ANTHROPIC], {
          endpointPolicy: { kind: 'eu', attestedHosts: [] },
        }),
        { ...BASE_ARGS, promptText: 'Hello there.' },
      ),
    ).resolves.toEqual({ ok: false, refusal: 'no-eu-model' });

    mockedWalk.mockResolvedValue(world());
    await expect(
      resolveChatModel(
        fakeCtx([ANTHROPIC, OPENAI], {
          endpointPolicy: { kind: 'unreadable' },
        }),
        { ...BASE_ARGS, promptText: 'Hello there.' },
      ),
    ).resolves.toEqual({ ok: false, refusal: 'model-policy-unreadable' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('model-policy-unreadable'),
    );
  });
});
