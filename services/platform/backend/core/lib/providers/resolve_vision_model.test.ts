import type { ProviderDefinition } from '@tale/shared/schemas/providers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { shimFunctionName } from '../../../lib/ctx-shim';
import type { ModelEndpointPolicy } from '../../governance/model_endpoint_gate';
import type { ActionCtx } from '../ctx';
import { getProviderCatalog } from './catalog_fetch';
import { resolveProvidersForOrgId } from './org_providers';
import {
  PREFERRED_VISION_MODELS,
  resolveOrgVisionModel,
  resolveTurnVisionModel,
} from './resolve_vision_model';

vi.mock('./org_providers', () => ({
  resolveProvidersForOrgId: vi.fn(),
}));
vi.mock('./catalog_fetch', () => ({
  getProviderCatalog: vi.fn(),
}));

const mockedResolveProviders = vi.mocked(resolveProvidersForOrgId);
const mockedCatalog = vi.mocked(getProviderCatalog);

function provider(name: string) {
  return {
    name,
    displayName: name,
    apiFormat: 'openai',
    baseUrl: `https://${name}.example.com/v1`,
    catalog: { source: 'static' },
    auth: [{ method: 'api-key' }],
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal provider shape for a unit test
  } as unknown as ProviderDefinition;
}

/** The resolver walks whatever provider set the org resolves to. */
function mockProviders(providers: ProviderDefinition[]): void {
  mockedResolveProviders.mockResolvedValue(providers);
}

interface FakeCredentialRow {
  authMethod: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker';
  status: 'active' | 'disabled';
  modelAllowlist?: string[];
}

const ENDPOINT_POLICY_QUERY =
  'governance/internal_queries:getModelEndpointPolicyInternal';

/**
 * Fake ActionCtx serving the three internal queries this module reads:
 * `getDefaultCredentialInternal` (keyed by provider slug),
 * `getPolicyConfigInternal` (the `vision_model` pin, `null` = Auto) and
 * `getModelEndpointPolicyInternal` (the EU/EEA rule, open unless a test turns
 * it on).
 */
function fakeCtx(
  rows: Record<string, FakeCredentialRow | null>,
  pinnedConfig: unknown = null,
  endpointPolicy: ModelEndpointPolicy = { kind: 'open' },
): ActionCtx {
  const runQuery = vi.fn(
    async (
      ref: unknown,
      args: { providerSlug?: string; policyType?: string },
    ) => {
      if (shimFunctionName(ref) === ENDPOINT_POLICY_QUERY) {
        return endpointPolicy;
      }
      return args.policyType !== undefined
        ? pinnedConfig
        : (rows[args.providerSlug ?? ''] ?? null);
    },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runQuery is exercised by this module
  return { runQuery } as unknown as ActionCtx;
}

function entry(args: {
  id: string;
  vision?: boolean;
  tags?: string[];
  inputPrice?: number;
  outputsMedia?: boolean;
}) {
  return {
    id: args.id,
    provider: 'x',
    tags: args.tags ?? ['chat'],
    supportsTools: true,
    supportsVision: args.vision ?? true,
    ...(args.outputsMedia !== undefined && { outputsMedia: args.outputsMedia }),
    contextWindow: 100_000,
    ...(args.inputPrice !== undefined && {
      pricing: {
        inputCentsPerMillion: args.inputPrice,
        outputCentsPerMillion: args.inputPrice * 2,
      },
    }),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('resolveOrgVisionModel', () => {
  it('picks the cheapest vision-capable chat model across active default credentials', async () => {
    mockProviders([provider('alpha'), provider('beta')]);
    mockedCatalog.mockImplementation(async (c) =>
      c.name === 'alpha'
        ? [
            entry({ id: 'pricey-vl', inputPrice: 500 }),
            entry({ id: 'text-only', vision: false, inputPrice: 1 }),
          ]
        : [entry({ id: 'cheap-vl', inputPrice: 20 })],
    );
    const ctx = fakeCtx({
      alpha: { authMethod: 'api-key', status: 'active' },
      beta: { authMethod: 'env', status: 'active' },
    });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'beta',
      modelId: 'cheap-vl',
      source: 'cheapest',
    });
  });

  it('never auto-selects a free-tier variant, however cheap', async () => {
    // A `:free` variant always wins the price sort at 0, but free tiers sit
    // behind per-account data-policy gates and hard rate caps — observed
    // live as a turn-long 401 storm. The priced sibling must win.
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'gemma-vl:free', inputPrice: 0 }),
      entry({ id: 'priced-vl', inputPrice: 40 }),
    ]);
    const ctx = fakeCtx({ alpha: { authMethod: 'api-key', status: 'active' } });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'alpha',
      modelId: 'priced-vl',
      source: 'cheapest',
    });
  });

  it('never auto-selects a media generator, however its listing reads', async () => {
    // OpenRouter lists Lyria (music generation) as image-in/text+audio-out
    // with a 0 token price (billing is per clip) — under a naive read it is
    // the cheapest "vision chat model" and every transcription call 400s.
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'lyria-clip', inputPrice: 0, outputsMedia: true }),
      entry({ id: 'priced-vl', inputPrice: 40 }),
    ]);
    const ctx = fakeCtx({ alpha: { authMethod: 'api-key', status: 'active' } });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'alpha',
      modelId: 'priced-vl',
      source: 'cheapest',
    });
  });

  it('never auto-selects an all-zero-priced lane, whatever its id', async () => {
    // The `openrouter/free` router is the `:free` data-policy/rate-cap
    // problem without the `:free` suffix — the all-zero token price is the
    // durable marker of the class.
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'free-router', inputPrice: 0 }),
      entry({ id: 'priced-vl', inputPrice: 40 }),
    ]);
    const ctx = fakeCtx({ alpha: { authMethod: 'api-key', status: 'active' } });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'alpha',
      modelId: 'priced-vl',
      source: 'cheapest',
    });
  });

  it('skips providers without an active, gateway-servable default credential', async () => {
    mockProviders([
      provider('none'),
      provider('disabled'),
      provider('broker'),
      provider('good'),
    ]);
    mockedCatalog.mockResolvedValue([entry({ id: 'vl', inputPrice: 10 })]);
    const ctx = fakeCtx({
      none: null,
      disabled: { authMethod: 'api-key', status: 'disabled' },
      broker: { authMethod: 'subscription-broker', status: 'active' },
      good: { authMethod: 'api-key', status: 'active' },
    });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'good',
      modelId: 'vl',
      source: 'cheapest',
    });
    // Only the one eligible provider's catalog was consulted at all.
    expect(mockedCatalog).toHaveBeenCalledTimes(1);
  });

  it("respects the default credential's model allowlist", async () => {
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'cheap-vl', inputPrice: 1 }),
      entry({ id: 'allowed-vl', inputPrice: 100 }),
    ]);
    const ctx = fakeCtx({
      alpha: {
        authMethod: 'api-key',
        status: 'active',
        modelAllowlist: ['allowed-vl'],
      },
    });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'alpha',
      modelId: 'allowed-vl',
      source: 'cheapest',
    });
  });

  it('admits an allowlisted model across provider id dialects, as every other lane does', async () => {
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'cheap-vl', inputPrice: 1 }),
      entry({ id: 'allowed-vl', inputPrice: 100 }),
    ]);
    // The allowlist names the qualified id; the catalog lists the bare one.
    const ctx = fakeCtx({
      alpha: {
        authMethod: 'api-key',
        status: 'active',
        modelAllowlist: ['alpha/allowed-vl'],
      },
    });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'alpha',
      modelId: 'allowed-vl',
      source: 'cheapest',
    });
  });

  it('prefers a curated vision model over a cheaper unknown one', async () => {
    // The price sort reads a live catalog, so "cheapest" tracks whatever a
    // provider listed most recently — it says nothing about transcription
    // quality. A curated head keeps the common case on a known-good model.
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'nobody/knows-this-vl', inputPrice: 2 }),
      entry({ id: PREFERRED_VISION_MODELS[0] ?? '', inputPrice: 40 }),
    ]);
    const ctx = fakeCtx({ alpha: { authMethod: 'api-key', status: 'active' } });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'alpha',
      modelId: PREFERRED_VISION_MODELS[0],
      source: 'preferred',
    });
  });

  it('matches a preferred model across provider id dialects', async () => {
    // One curated entry has to cover every provider's spelling of the same
    // model — a vendor-prefix difference is not a different model.
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'cheap-vl', inputPrice: 1 }),
      entry({ id: 'qwen3-vl-32b-instruct', inputPrice: 40 }),
    ]);
    const ctx = fakeCtx({ alpha: { authMethod: 'api-key', status: 'active' } });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'alpha',
      modelId: 'qwen3-vl-32b-instruct',
      source: 'preferred',
    });
  });

  it("honours the admin's pin over both the preferred and the cheapest model", async () => {
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'cheap-vl', inputPrice: 1 }),
      entry({ id: PREFERRED_VISION_MODELS[0] ?? '', inputPrice: 40 }),
      entry({ id: 'pinned-vl', inputPrice: 900 }),
    ]);
    const ctx = fakeCtx(
      { alpha: { authMethod: 'api-key', status: 'active' } },
      {
        providerSlug: 'alpha',
        modelId: 'pinned-vl',
      },
    );
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'alpha',
      modelId: 'pinned-vl',
      source: 'pinned',
    });
  });

  it('refuses when the pin is no longer servable instead of selecting another model', async () => {
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([entry({ id: 'cheap-vl', inputPrice: 1 })]);
    const ctx = fakeCtx(
      { alpha: { authMethod: 'api-key', status: 'active' } },
      {
        providerSlug: 'alpha',
        modelId: 'model-that-went-away',
      },
    );
    await expect(resolveOrgVisionModel(ctx, 'org_1')).rejects.toMatchObject({
      name: 'VisionModelPolicyError',
      code: 'VISION_MODEL_UNAVAILABLE',
    });
  });

  it('refuses an unparseable pin before consulting a provider', async () => {
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([entry({ id: 'cheap-vl', inputPrice: 1 })]);
    // Half a pin: a provider with no model cannot be routed.
    const ctx = fakeCtx(
      { alpha: { authMethod: 'api-key', status: 'active' } },
      {
        providerSlug: 'alpha',
      },
    );
    await expect(resolveOrgVisionModel(ctx, 'org_1')).rejects.toMatchObject({
      name: 'VisionModelPolicyError',
      code: 'VISION_MODEL_POLICY_INVALID',
    });
    expect(mockedResolveProviders).not.toHaveBeenCalled();
    expect(mockedCatalog).not.toHaveBeenCalled();
  });

  it('a failing catalog skips that provider, not the whole resolution', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockProviders([provider('flaky'), provider('good')]);
    mockedCatalog.mockImplementation(async (c) => {
      if (c.name === 'flaky') throw new Error('endpoint down');
      return [entry({ id: 'vl', inputPrice: 10 })];
    });
    const ctx = fakeCtx({
      flaky: { authMethod: 'api-key', status: 'active' },
      good: { authMethod: 'api-key', status: 'active' },
    });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'good',
      modelId: 'vl',
      source: 'cheapest',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('catalog for flaky unavailable'),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it('returns null when nothing vision-capable is reachable', async () => {
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'text-only', vision: false }),
      entry({ id: 'embed', vision: true, tags: ['embedding'] }),
      entry({ id: 'music-gen', inputPrice: 0, outputsMedia: true }),
    ]);
    const ctx = fakeCtx({
      alpha: { authMethod: 'api-key', status: 'active' },
    });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toBeNull();
  });

  it('ranks unpriced entries last and tie-breaks deterministically', async () => {
    mockProviders([provider('zeta'), provider('alpha')]);
    mockedCatalog.mockImplementation(async (c) =>
      c.name === 'zeta'
        ? [entry({ id: 'vl-z', inputPrice: 10 }), entry({ id: 'unpriced' })]
        : [entry({ id: 'vl-a', inputPrice: 10 })],
    );
    const ctx = fakeCtx({
      zeta: { authMethod: 'api-key', status: 'active' },
      alpha: { authMethod: 'api-key', status: 'active' },
    });
    // Same price on two providers → the lexically smaller provider wins,
    // regardless of provider iteration order.
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'alpha',
      modelId: 'vl-a',
      source: 'cheapest',
    });
  });
});

describe('auto-selection under the EU/EEA rule [GOV-R17]', () => {
  const active: FakeCredentialRow = { authMethod: 'api-key', status: 'active' };

  function euRule(...attestedHosts: string[]): ModelEndpointPolicy {
    return { kind: 'eu', attestedHosts };
  }

  function at(name: string, baseUrl: string): ProviderDefinition {
    return { ...provider(name), baseUrl };
  }

  /** Two vision providers, the first listing the cheaper model; both hold
   * an active default credential. */
  function cheapAndDear(
    cheap: ProviderDefinition,
    dear: ProviderDefinition,
  ): Record<string, FakeCredentialRow> {
    mockProviders([cheap, dear]);
    mockedCatalog.mockImplementation(async (listed) =>
      listed.name === cheap.name
        ? [entry({ id: 'cheap-vl', inputPrice: 5 })]
        : [entry({ id: 'dear-vl', inputPrice: 500 })],
    );
    return { [cheap.name]: active, [dear.name]: active };
  }

  it('passes over a provider not known to process in the EU/EEA, for one at an EU endpoint', async () => {
    const rows = cheapAndDear(
      at('outside', 'https://llm.example.com/v1'),
      at('mistral-eu', 'https://api.eu.mistral.ai/v1'),
    );
    await expect(
      resolveOrgVisionModel(fakeCtx(rows, null, euRule()), 'org_1'),
    ).resolves.toEqual({
      providerSlug: 'mistral-eu',
      modelId: 'dear-vl',
      source: 'cheapest',
    });
    // Passed over unasked: neither its catalog nor its credential is read.
    expect(
      mockedCatalog.mock.calls.some(([listed]) => listed.name === 'outside'),
    ).toBe(false);
    // With the rule off the cheaper provider wins, as it always did.
    await expect(
      resolveOrgVisionModel(fakeCtx(rows), 'org_1'),
    ).resolves.toEqual({
      providerSlug: 'outside',
      modelId: 'cheap-vl',
      source: 'cheapest',
    });
  });

  it('picks a provider on a host an admin attested', async () => {
    const rows = cheapAndDear(
      at('outside', 'https://llm.example.com/v1'),
      at('own-proxy', 'https://llm.eu-proxy.example/v1'),
    );
    await expect(
      resolveOrgVisionModel(
        fakeCtx(rows, null, euRule('llm.eu-proxy.example')),
        'org_1',
      ),
    ).resolves.toEqual({
      providerSlug: 'own-proxy',
      modelId: 'dear-vl',
      source: 'cheapest',
    });
  });

  it('reaches OpenRouter only through a record pointed at eu.openrouter.ai', async () => {
    // The gateway's built-in OpenRouter connection calls openrouter.ai
    // whatever the standard record's base URL says; a custom record calls
    // its own, and openrouter.ai itself may process anywhere.
    mockProviders([
      at('openrouter', 'https://eu.openrouter.ai/api/v1'),
      at('openrouter-global', 'https://openrouter.ai/api/v1'),
      at('openrouter-eu', 'https://eu.openrouter.ai/api/v1'),
    ]);
    mockedCatalog.mockImplementation(async (listed) => [
      entry({
        id: `${listed.name}-vl`,
        inputPrice: listed.name === 'openrouter-eu' ? 500 : 5,
      }),
    ]);
    const ctx = fakeCtx(
      {
        openrouter: active,
        'openrouter-global': active,
        'openrouter-eu': active,
      },
      null,
      euRule(),
    );
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'openrouter-eu',
      modelId: 'openrouter-eu-vl',
      source: 'cheapest',
    });
  });

  it.each<[string, ModelEndpointPolicy]>([
    ['refuses every provider', euRule()],
    ['cannot be read', { kind: 'unreadable' }],
  ])(
    'finds no vision model when the rule %s, and the turn runs text-only',
    async (_case, endpointPolicy) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rows = cheapAndDear(
        at('outside', 'https://llm.example.com/v1'),
        at('openrouter', 'https://eu.openrouter.ai/api/v1'),
      );
      const ctx = fakeCtx(rows, null, endpointPolicy);
      await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toBeNull();
      await expect(
        resolveTurnVisionModel(ctx, 'org_1', {
          providerSlug: 'outside',
          modelId: 'text-only',
        }),
      ).resolves.toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('no vision-capable model is reachable'),
      );
      warn.mockRestore();
    },
  );

  it("returns a pin the rule refuses: the admin's word, which the key's provision refuses with the rule's reason", async () => {
    mockProviders([at('outside', 'https://llm.example.com/v1')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'pinned-vl', inputPrice: 5 }),
    ]);
    const ctx = fakeCtx(
      { outside: active },
      { providerSlug: 'outside', modelId: 'pinned-vl' },
      euRule(),
    );
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'outside',
      modelId: 'pinned-vl',
      source: 'pinned',
    });
  });
});

describe('explicit vision policy boundaries', () => {
  it.each([
    'missing-provider',
    'missing-model',
    'missing-credential',
    'disabled-credential',
    'subscription-credential',
    'excluded-model',
    'text-model',
    'media-generator',
  ])('holds %s without trying the available hosted model', async (reason) => {
    mockProviders([
      provider('hosted'),
      ...(reason === 'missing-provider' ? [] : [provider('local')]),
    ]);
    mockedCatalog.mockImplementation(async (candidate) =>
      candidate.name === 'hosted'
        ? [entry({ id: PREFERRED_VISION_MODELS[0] ?? '', inputPrice: 1 })]
        : [
            entry({ id: 'local-text', vision: false }),
            entry({
              id: reason === 'missing-model' ? 'other-vision' : 'chosen-vision',
              vision: reason !== 'text-model',
              outputsMedia: reason === 'media-generator',
            }),
          ],
    );
    const ctx = fakeCtx(
      {
        hosted: { authMethod: 'api-key', status: 'active' },
        local:
          reason === 'missing-credential'
            ? null
            : {
                authMethod:
                  reason === 'subscription-credential'
                    ? 'subscription-key'
                    : 'api-key',
                status:
                  reason === 'disabled-credential' ? 'disabled' : 'active',
                ...(reason === 'excluded-model'
                  ? { modelAllowlist: ['local-text'] }
                  : {}),
              },
      },
      { providerSlug: 'local', modelId: 'chosen-vision' },
    );
    for (const resolution of [
      () => resolveOrgVisionModel(ctx, 'org_1'),
      () =>
        resolveTurnVisionModel(ctx, 'org_1', {
          providerSlug: 'local',
          modelId: 'local-text',
        }),
    ]) {
      await expect(resolution()).rejects.toMatchObject({
        name: 'VisionModelPolicyError',
        code: 'VISION_MODEL_UNAVAILABLE',
      });
    }
    expect(
      mockedCatalog.mock.calls.some(([value]) => value.name === 'hosted'),
    ).toBe(false);
  });

  it.each(['providers', 'credential', 'catalog'])(
    'does not swallow a pinned %s resolver failure',
    async (failure) => {
      mockProviders([provider('local')]);
      mockedCatalog.mockResolvedValue([
        entry({ id: 'local-text', vision: false }),
      ]);
      const ctx = fakeCtx(
        { local: { authMethod: 'api-key', status: 'active' } },
        { providerSlug: 'local', modelId: 'chosen-vision' },
      );
      const privateError = new Error('private endpoint token=do-not-disclose');
      if (failure === 'providers')
        mockedResolveProviders.mockRejectedValue(privateError);
      if (failure === 'catalog') mockedCatalog.mockRejectedValue(privateError);
      if (failure === 'credential') {
        vi.spyOn(ctx, 'runQuery').mockImplementation(async (_ref, args) => {
          if (args.policyType)
            return { providerSlug: 'local', modelId: 'chosen-vision' };
          throw privateError;
        });
      }
      for (const resolution of [
        () => resolveOrgVisionModel(ctx, 'org_1'),
        () =>
          resolveTurnVisionModel(ctx, 'org_1', {
            providerSlug: 'local',
            modelId: 'local-text',
          }),
      ]) {
        const error = await resolution().catch((caught: unknown) => caught);
        expect(error).toMatchObject({
          name: 'VisionModelPolicyError',
          code: 'VISION_MODEL_RESOLUTION_FAILED',
        });
        expect(String(error)).not.toContain('do-not-disclose');
      }
    },
  );

  it('cannot assume Auto when an explicit polyfill policy read fails', async () => {
    mockProviders([provider('local')]);
    mockedCatalog.mockResolvedValue([entry({ id: 'omni' })]);
    const ctx = fakeCtx({});
    vi.spyOn(ctx, 'runQuery').mockRejectedValue(
      new Error('private governance path'),
    );
    await expect(resolveOrgVisionModel(ctx, 'org_1')).rejects.toMatchObject({
      code: 'VISION_MODEL_POLICY_UNAVAILABLE',
    });
    expect(mockedResolveProviders).not.toHaveBeenCalled();
  });

  it.each(['invalid', 'unreadable'])(
    'survives an %s vision policy when the serving model already reads images',
    async (policy) => {
      // The policy is consulted for the lane model, but a broken one never
      // costs a vision-capable serving model its turn: the lane falls back to
      // the serving model itself.
      mockProviders([provider('local')]);
      mockedCatalog.mockResolvedValue([entry({ id: 'omni' })]);
      const ctx = fakeCtx({}, { providerSlug: 'incomplete-pin' });
      const query = vi.spyOn(ctx, 'runQuery');
      if (policy === 'unreadable')
        query.mockRejectedValue(new Error('private governance path'));
      await expect(
        resolveTurnVisionModel(ctx, 'org_1', {
          providerSlug: 'local',
          modelId: 'omni',
        }),
      ).resolves.toEqual({
        model: { providerSlug: 'local', modelId: 'omni', source: 'serving' },
        polyfillReads: false,
      });
      expect(mockedCatalog).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ name: 'local' }),
        {},
      );
    },
  );

  it.each([
    'text-only',
    'unknown-model',
    'unknown-provider',
    'failed-discovery',
  ])(
    'still refuses unreadable policy for a %s serving target',
    async (target) => {
      mockProviders([provider('local')]);
      mockedCatalog.mockResolvedValue([
        entry({ id: 'text-only', vision: false }),
      ]);
      if (target === 'failed-discovery')
        mockedResolveProviders.mockRejectedValue(
          new Error('private provider endpoint'),
        );
      const ctx = fakeCtx({});
      const query = vi
        .spyOn(ctx, 'runQuery')
        .mockRejectedValue(new Error('private governance path'));
      await expect(
        resolveTurnVisionModel(ctx, 'org_1', {
          providerSlug: target === 'unknown-provider' ? 'missing' : 'local',
          modelId: target === 'unknown-model' ? 'missing' : 'text-only',
        }),
      ).rejects.toMatchObject({ code: 'VISION_MODEL_POLICY_UNAVAILABLE' });
      expect(query).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
        organizationId: 'org_1',
        policyType: 'vision_model',
      });
    },
  );

  it('does not force a polyfill for a serving model that already reads images', async () => {
    mockProviders([provider('local')]);
    mockedCatalog.mockResolvedValue([entry({ id: 'omni' })]);
    const ctx = fakeCtx(
      { local: { authMethod: 'api-key', status: 'active' } },
      { providerSlug: 'local', modelId: 'chosen-polyfill' },
    );
    // The pin names a model the catalog does not serve: a text-only serving
    // would refuse the turn, a vision-capable one keeps its turn and reads
    // its own images — the lane falls back to the serving model.
    await expect(
      resolveTurnVisionModel(ctx, 'org_1', {
        providerSlug: 'local',
        modelId: 'omni',
      }),
    ).resolves.toEqual({
      model: { providerSlug: 'local', modelId: 'omni', source: 'serving' },
      polyfillReads: false,
    });
  });

  it('keeps explicit empty Auto policy selection unchanged', async () => {
    mockProviders([provider('hosted')]);
    mockedCatalog.mockResolvedValue([entry({ id: 'automatic-vision' })]);
    const ctx = fakeCtx(
      { hosted: { authMethod: 'api-key', status: 'active' } },
      {},
    );
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toMatchObject({
      source: 'cheapest',
      modelId: 'automatic-vision',
    });
  });
});

// The per-turn wrapper arms the sandbox's vision lane for every MANAGED
// gateway turn that can have one — the in-image tools transcribe images
// through it whether or not the serving model sees images — and decides
// separately whether the turn needs the READ polyfill: only a text-only
// serving model does, since arming it for a model that reads images would
// route them through a second (worse) model for no reason. A text-only
// harness that meets a scanned PDF 404s the whole turn without a lane.
describe('resolveTurnVisionModel', () => {
  it('arms the org vision model for the lane, without the polyfill, when the serving model reads images itself', async () => {
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'omni-vl', inputPrice: 900 }),
      entry({ id: 'cheap-vl', inputPrice: 5 }),
    ]);
    const ctx = fakeCtx({ alpha: { authMethod: 'api-key', status: 'active' } });
    await expect(
      resolveTurnVisionModel(ctx, 'org_1', {
        providerSlug: 'alpha',
        modelId: 'omni-vl',
      }),
    ).resolves.toEqual({
      model: { providerSlug: 'alpha', modelId: 'cheap-vl', source: 'cheapest' },
      polyfillReads: false,
    });
  });

  it('falls back to the serving model for the lane when nothing else is reachable and it reads images', async () => {
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'omni-vl', inputPrice: 900 }),
    ]);
    const ctx = fakeCtx({ alpha: { authMethod: 'api-key', status: 'active' } });
    await expect(
      resolveTurnVisionModel(ctx, 'org_1', {
        providerSlug: 'alpha',
        modelId: 'omni-vl',
      }),
    ).resolves.toEqual({
      model: { providerSlug: 'alpha', modelId: 'omni-vl', source: 'cheapest' },
      polyfillReads: false,
    });
  });

  it('keeps a vision-capable serving model on its own lane when discovery throws', async () => {
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'omni-vl', inputPrice: 900 }),
    ]);
    const ctx = fakeCtx({ alpha: { authMethod: 'api-key', status: 'active' } });
    // The serving entry resolves (catalog answers once), then the credential
    // read behind the org resolution fails.
    vi.spyOn(ctx, 'runQuery').mockImplementation(async (ref, args) => {
      if (args.policyType) return null;
      if (shimFunctionName(ref) === ENDPOINT_POLICY_QUERY) {
        return { kind: 'open' };
      }
      throw new Error('private credential path');
    });
    await expect(
      resolveTurnVisionModel(ctx, 'org_1', {
        providerSlug: 'alpha',
        modelId: 'omni-vl',
      }),
    ).resolves.toEqual({
      model: { providerSlug: 'alpha', modelId: 'omni-vl', source: 'serving' },
      polyfillReads: false,
    });
  });

  it('picks the org vision model and the polyfill for a TEXT-ONLY serving model', async () => {
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'text-only', vision: false, inputPrice: 1 }),
      entry({ id: 'cheap-vl', inputPrice: 5 }),
    ]);
    const ctx = fakeCtx({ alpha: { authMethod: 'api-key', status: 'active' } });
    await expect(
      resolveTurnVisionModel(ctx, 'org_1', {
        providerSlug: 'alpha',
        modelId: 'text-only',
      }),
    ).resolves.toEqual({
      model: { providerSlug: 'alpha', modelId: 'cheap-vl', source: 'cheapest' },
      polyfillReads: true,
    });
  });

  it('resolves a vision model with the polyfill when the serving model is not in the catalog', async () => {
    // A model served by a credential allowlist but absent from the fetched
    // catalog must not be assumed vision-capable.
    mockProviders([provider('alpha')]);
    mockedCatalog.mockResolvedValue([entry({ id: 'cheap-vl', inputPrice: 5 })]);
    const ctx = fakeCtx({ alpha: { authMethod: 'api-key', status: 'active' } });
    await expect(
      resolveTurnVisionModel(ctx, 'org_1', {
        providerSlug: 'alpha',
        modelId: 'mystery-model',
      }),
    ).resolves.toEqual({
      model: { providerSlug: 'alpha', modelId: 'cheap-vl', source: 'cheapest' },
      polyfillReads: true,
    });
  });

  it('degrades to null (turn runs text-only) when resolution throws for a text-only serving model', async () => {
    mockedResolveProviders.mockRejectedValue(new Error('catalog down'));
    const ctx = fakeCtx({});
    await expect(
      resolveTurnVisionModel(ctx, 'org_1', {
        providerSlug: 'alpha',
        modelId: 'text-only',
      }),
    ).resolves.toBeNull();
  });

  describe('a model of a provider without a catalog', () => {
    // An organization's own gateway lists nothing: what its definition
    // declares about a model's image input is all there is to go by.
    const gateway: ProviderDefinition = {
      ...provider('claude-gateway'),
      catalog: {
        source: 'none',
        models: [
          { id: 'claude-sonnet-gw', supportsVision: true },
          { id: 'claude-haiku-gw', contextWindow: 200_000 },
        ],
      },
    };

    function servedThroughGateway(): ActionCtx {
      mockProviders([gateway, provider('alpha')]);
      mockedCatalog.mockImplementation(async (listed) =>
        listed.name === 'alpha'
          ? [entry({ id: 'cheap-vl', inputPrice: 5 })]
          : [],
      );
      return fakeCtx({
        'claude-gateway': {
          authMethod: 'api-key',
          status: 'active',
          modelAllowlist: ['claude-sonnet-gw', 'claude-haiku-gw'],
        },
        alpha: { authMethod: 'api-key', status: 'active' },
      });
    }

    it('reads images itself when its provider declares that it does', async () => {
      await expect(
        resolveTurnVisionModel(servedThroughGateway(), 'org_1', {
          providerSlug: 'claude-gateway',
          modelId: 'claude-sonnet-gw',
        }),
      ).resolves.toEqual({
        model: {
          providerSlug: 'alpha',
          modelId: 'cheap-vl',
          source: 'cheapest',
        },
        polyfillReads: false,
      });
    });

    it('reads images through the polyfill when its provider declares nothing about them', async () => {
      await expect(
        resolveTurnVisionModel(servedThroughGateway(), 'org_1', {
          providerSlug: 'claude-gateway',
          modelId: 'claude-haiku-gw',
        }),
      ).resolves.toEqual({
        model: {
          providerSlug: 'alpha',
          modelId: 'cheap-vl',
          source: 'cheapest',
        },
        polyfillReads: true,
      });
    });
  });
});
