/**
 * The image-model resolver behind the `generate_image` tool: the policy is
 * the switch (off until an admin turns it on), a pin wins but never falls
 * back, and automatic selection walks a short curated list through the two
 * providers whose image APIs were verified. These tests pin the policy
 * reading, the admission (API-servable default credential, allowlist, image
 * tag, no OpenRouter routers) and the settings view.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../ctx';

const resolveProvidersMock = vi.fn();
vi.mock('./org_providers', () => ({
  resolveProvidersForOrgId: (...args: unknown[]) =>
    resolveProvidersMock(...(args as [])),
}));

const catalogMock = vi.fn();
vi.mock('./servable_catalog', () => ({
  getServableCatalog: (...args: unknown[]) => catalogMock(...(args as [])),
}));

const credentialMock = vi.fn();
vi.mock(
  '../../provider_credentials/resolve_credential',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../provider_credentials/resolve_credential')
    >()),
    resolveProviderCredential: (...args: unknown[]) =>
      credentialMock(...(args as [])),
  }),
);

import { shimFunctionName } from '../../../lib/ctx-shim';
import {
  type ModelEndpointPolicy,
  ModelEndpointRefusal,
} from '../../governance/model_endpoint_gate';
import { ConfigurationError } from '../config_store/precondition';
import {
  ImageGenerationError,
  inspectImageGenerationModels,
  resolveImageGenerationModel,
  resolveTurnImageGeneration,
} from './resolve_image_model';

const ORG = 'org_images';
const ACTIVE_API_KEY_ROW = { authMethod: 'api-key', status: 'active' };

let defaultRows: Record<string, unknown> = {};
let policy: unknown = null;
let endpointPolicy: ModelEndpointPolicy = { kind: 'open' };
const runQuery = vi.fn(
  async (
    ref: unknown,
    args: { providerSlug?: string; policyType?: string },
  ) => {
    if (
      shimFunctionName(ref) ===
      'governance/internal_queries:getModelEndpointPolicyInternal'
    ) {
      return endpointPolicy;
    }
    if (args.policyType !== undefined) {
      if (policy instanceof Error) throw policy;
      return policy;
    }
    const slug = args.providerSlug ?? '';
    return slug in defaultRows ? defaultRows[slug] : ACTIVE_API_KEY_ROW;
  },
);
// The EU/EEA rule's audit entry for a refused model (GOV-R17).
const runMutation = vi.fn(async (_ref: unknown, _args: unknown) => null);
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runQuery and the refusal's audit entry are exercised by this module
const ctx = { runQuery, runMutation } as unknown as ActionCtx;

const OPENROUTER = {
  name: 'openrouter',
  displayName: 'OpenRouter',
  apiFormat: 'openai',
  baseUrl: 'https://openrouter.ai/api/v1',
  catalog: { source: 'openrouter-api' },
};
const OPENAI = {
  name: 'openai',
  displayName: 'OpenAI',
  apiFormat: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  catalog: { source: 'static' },
};
const LOCAL = {
  name: 'local-images',
  displayName: 'Local images',
  apiFormat: 'openai',
  baseUrl: 'https://images.internal.example/v1',
  catalog: { source: 'models-endpoint' },
};
const ANTHROPIC = {
  name: 'anthropic',
  displayName: 'Anthropic',
  apiFormat: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  catalog: { source: 'static' },
};

function image(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    tags: ['vision', 'image-generation'],
    supportsVision: true,
    supportsTools: false,
    outputsMedia: true,
    contextWindow: 32_768,
    ...extra,
  };
}
const CHAT = { id: 'gpt-5.5', tags: ['chat'], supportsVision: true };

const CATALOGS: Record<string, unknown[]> = {
  openrouter: [
    CHAT,
    image('openrouter/auto'),
    image('black-forest-labs/flux.2-pro'),
    image('google/gemini-2.5-flash-image', {
      tags: ['chat', 'vision', 'image-generation'],
    }),
  ],
  openai: [
    CHAT,
    image('gpt-image-2.5-sunburst', {
      pricing: {
        inputCentsPerMillion: 500,
        outputCentsPerMillion: 3000,
        imageInputCentsPerMillion: 800,
      },
    }),
    image('gpt-image-2.5-flare'),
    image('gpt-image-1-mini'),
  ],
  'local-images': [image('google/gemini-2.5-flash-image')],
};

function apiKey(secret = 'sk-test') {
  return { authMethod: 'api-key', secret };
}

beforeEach(() => {
  resolveProvidersMock.mockReset();
  catalogMock
    .mockReset()
    .mockImplementation(
      async (provider: { name: string }) => CATALOGS[provider.name] ?? [],
    );
  credentialMock.mockReset().mockResolvedValue(apiKey());
  runQuery.mockClear();
  runMutation.mockClear();
  defaultRows = {};
  policy = null;
  endpointPolicy = { kind: 'open' };
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((caught: unknown) => caught);
  if (error instanceof ImageGenerationError) return error.code;
  throw new Error(`expected an ImageGenerationError, got ${String(error)}`);
}

describe('resolveImageGenerationModel — the policy is the switch', () => {
  it.each([
    ['no policy file', null],
    ['enabled: false', { enabled: false }],
    [
      'a parked pin while off',
      {
        enabled: false,
        providerSlug: 'openai',
        modelId: 'gpt-image-2.5-sunburst',
      },
    ],
  ])('is off with %s, walking no provider', async (_label, config) => {
    policy = config;
    resolveProvidersMock.mockResolvedValue([OPENROUTER, OPENAI]);
    await expect(resolveImageGenerationModel(ctx, ORG)).resolves.toBeNull();
    expect(resolveProvidersMock).not.toHaveBeenCalled();
    expect(credentialMock).not.toHaveBeenCalled();
  });

  it('names a malformed policy instead of reading it as on or off', async () => {
    policy = { enabled: true, providerSlug: 'openai' };
    expect(await codeOf(resolveImageGenerationModel(ctx, ORG))).toBe(
      'IMAGE_GENERATION_POLICY_INVALID',
    );
  });

  it.each([
    [
      new ConfigurationError('GOVERNANCE_POLICY_INVALID', 'invalid', 400),
      'IMAGE_GENERATION_POLICY_INVALID',
    ],
    [
      new Error('config root unreadable'),
      'IMAGE_GENERATION_POLICY_UNAVAILABLE',
    ],
  ])('maps an unreadable policy to a coded refusal', async (error, code) => {
    policy = error;
    expect(await codeOf(resolveImageGenerationModel(ctx, ORG))).toBe(code);
  });
});

describe('resolveImageGenerationModel — pinned', () => {
  it('serves the pinned model through its own provider wire', async () => {
    policy = {
      enabled: true,
      providerSlug: 'openai',
      modelId: 'gpt-image-2.5-sunburst',
    };
    resolveProvidersMock.mockResolvedValue([OPENROUTER, OPENAI]);
    const resolved = await resolveImageGenerationModel(ctx, ORG);
    expect(resolved).toMatchObject({
      providerSlug: 'openai',
      modelId: 'gpt-image-2.5-sunburst',
      source: 'pinned',
      wire: 'openai-images',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      acceptsImageInput: true,
      pricing: {
        inputCentsPerMillion: 500,
        outputCentsPerMillion: 3000,
        imageInputCentsPerMillion: 800,
      },
    });
    // Only the pinned provider is walked.
    expect(catalogMock).toHaveBeenCalledTimes(1);
  });

  it('lets an admin pin a model of a provider automatic selection never uses', async () => {
    policy = {
      enabled: true,
      providerSlug: 'local-images',
      modelId: 'google/gemini-2.5-flash-image',
    };
    resolveProvidersMock.mockResolvedValue([LOCAL]);
    await expect(resolveImageGenerationModel(ctx, ORG)).resolves.toMatchObject({
      providerSlug: 'local-images',
      wire: 'openai-images',
      source: 'pinned',
    });
  });

  it.each([
    ['a model its catalog no longer lists', { modelId: 'gpt-image-9' }, {}],
    [
      'a model the credential allowlist refuses',
      {},
      {
        openai: {
          ...ACTIVE_API_KEY_ROW,
          modelAllowlist: ['gpt-image-1-mini'],
        },
      },
    ],
    [
      'a subscription default credential',
      {},
      { openai: { authMethod: 'subscription-broker', status: 'active' } },
    ],
    [
      'a disabled default credential',
      {},
      { openai: { authMethod: 'api-key', status: 'disabled' } },
    ],
  ])(
    'refuses a pin that is not servable (%s) and never falls back',
    async (_label, pinOverride, rows) => {
      policy = {
        enabled: true,
        providerSlug: 'openai',
        modelId: 'gpt-image-2.5-sunburst',
        ...pinOverride,
      };
      defaultRows = rows;
      resolveProvidersMock.mockResolvedValue([OPENROUTER, OPENAI]);
      expect(await codeOf(resolveImageGenerationModel(ctx, ORG))).toBe(
        'IMAGE_GENERATION_MODEL_UNAVAILABLE',
      );
    },
  );

  it('says the pin could not be checked when its provider failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    policy = {
      enabled: true,
      providerSlug: 'openai',
      modelId: 'gpt-image-2.5-sunburst',
    };
    resolveProvidersMock.mockResolvedValue([OPENAI]);
    catalogMock.mockRejectedValue(new Error('catalog down'));
    expect(await codeOf(resolveImageGenerationModel(ctx, ORG))).toBe(
      'IMAGE_GENERATION_RESOLUTION_FAILED',
    );
  });
});

describe('resolveImageGenerationModel — automatic', () => {
  it('takes the first curated model the organization can reach', async () => {
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([OPENAI, OPENROUTER]);
    await expect(resolveImageGenerationModel(ctx, ORG)).resolves.toMatchObject({
      providerSlug: 'openrouter',
      modelId: 'google/gemini-2.5-flash-image',
      source: 'preferred',
      wire: 'openrouter-images',
      attribution: { 'HTTP-Referer': 'https://tale.dev', 'X-Title': 'Tale' },
    });
  });

  it('falls to the next curated model, across provider spellings', async () => {
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([OPENAI]);
    await expect(resolveImageGenerationModel(ctx, ORG)).resolves.toMatchObject({
      providerSlug: 'openai',
      modelId: 'gpt-image-2.5-flare',
      source: 'preferred',
    });
  });

  it('keeps GPT Image 1 Mini behind its successor until OpenAI shuts it down', async () => {
    policy = { enabled: true };
    defaultRows = {
      openai: { ...ACTIVE_API_KEY_ROW, modelAllowlist: ['gpt-image-1-mini'] },
    };
    resolveProvidersMock.mockResolvedValue([OPENAI]);
    await expect(resolveImageGenerationModel(ctx, ORG)).resolves.toMatchObject({
      modelId: 'gpt-image-1-mini',
      source: 'preferred',
    });
  });

  it('honours the credential allowlist', async () => {
    policy = { enabled: true };
    defaultRows = {
      openrouter: {
        ...ACTIVE_API_KEY_ROW,
        modelAllowlist: ['black-forest-labs/flux.2-pro'],
      },
    };
    resolveProvidersMock.mockResolvedValue([OPENROUTER]);
    await expect(resolveImageGenerationModel(ctx, ORG)).resolves.toMatchObject({
      modelId: 'black-forest-labs/flux.2-pro',
    });
  });

  it('never picks automatically through a provider whose image API is unverified', async () => {
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([LOCAL]);
    expect(await codeOf(resolveImageGenerationModel(ctx, ORG))).toBe(
      'NO_IMAGE_GENERATION_MODEL',
    );
  });

  it('offers no model when only non-curated image models are reachable', async () => {
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([OPENROUTER]);
    catalogMock.mockResolvedValue([image('recraft/recraft-v4.1')]);
    expect(await codeOf(resolveImageGenerationModel(ctx, ORG))).toBe(
      'NO_IMAGE_GENERATION_MODEL',
    );
  });

  it('skips a provider without an API-servable default credential before any secret read', async () => {
    policy = { enabled: true };
    defaultRows = { openrouter: null };
    resolveProvidersMock.mockResolvedValue([OPENROUTER, ANTHROPIC, OPENAI]);
    await expect(resolveImageGenerationModel(ctx, ORG)).resolves.toMatchObject({
      providerSlug: 'openai',
    });
    // Anthropic speaks no image wire; OpenRouter has no usable default.
    expect(credentialMock).toHaveBeenCalledTimes(1);
    expect(credentialMock).toHaveBeenCalledWith(ctx, {
      organizationId: ORG,
      providerSlug: 'openai',
    });
  });
});

describe('resolveTurnImageGeneration', () => {
  it('names the pick for the grant, and nothing secret', async () => {
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([OPENROUTER]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(resolveTurnImageGeneration(ctx, ORG)).resolves.toEqual({
      providerSlug: 'openrouter',
      modelId: 'google/gemini-2.5-flash-image',
      source: 'preferred',
    });
  });

  it('answers null — no tool — instead of failing the turn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([LOCAL]);
    await expect(resolveTurnImageGeneration(ctx, ORG)).resolves.toBeNull();
    policy = new Error('unreadable');
    await expect(resolveTurnImageGeneration(ctx, ORG)).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('resolveImageGenerationModel — what a model draws from', () => {
  /** Abridged facts from OpenRouter's image model listing (2026-10-27). */
  const FACT_CATALOG = [
    image('krea/k3-edit', {
      imageGeneration: { referenceImages: { min: 1, max: 8 } },
    }),
    image('recraft/recraft-v4-vector', {
      imageGeneration: { outputFormats: ['svg'] },
    }),
    image('recraft/recraft-v4.1', {
      imageGeneration: {
        aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
        referenceImages: { min: 0, max: 1 },
      },
    }),
    image('recraft/recraft-v4.1-flash', {
      supportsVision: false,
      tags: ['image-generation'],
      imageGeneration: { aspectRatios: ['1:1', '4:3', '3:4'] },
    }),
    image('qwen/qwen-image-3', {
      imageGeneration: { referenceImages: { min: 0, max: 0 } },
    }),
    image('black-forest-labs/flux.2-pro', {
      imageGeneration: { outputFormats: ['png', 'jpeg'] },
    }),
  ];

  it('offers no model that returns only SVG, and an edit model only by pin', async () => {
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([OPENROUTER]);
    catalogMock.mockResolvedValue(FACT_CATALOG);
    const status = await inspectImageGenerationModels(ctx, ORG);
    // A vector model returns SVG, which the platform does not store; an edit
    // model may be chosen, and draws from the pictures an agent passes.
    expect(status.models.map((model) => model.modelId)).toEqual([
      'black-forest-labs/flux.2-pro',
      'krea/k3-edit',
      'qwen/qwen-image-3',
      'recraft/recraft-v4.1',
      'recraft/recraft-v4.1-flash',
    ]);
    policy = {
      enabled: true,
      providerSlug: 'openrouter',
      modelId: 'recraft/recraft-v4-vector',
    };
    expect(await codeOf(resolveImageGenerationModel(ctx, ORG))).toBe(
      'IMAGE_GENERATION_MODEL_UNAVAILABLE',
    );
    policy = {
      enabled: true,
      providerSlug: 'openrouter',
      modelId: 'krea/k3-edit',
    };
    await expect(resolveImageGenerationModel(ctx, ORG)).resolves.toMatchObject({
      modelId: 'krea/k3-edit',
      minReferenceImages: 1,
      maxReferenceImages: 8,
    });
  });

  it('carries the shapes a model draws and how many reference images it takes', async () => {
    resolveProvidersMock.mockResolvedValue([OPENROUTER]);
    catalogMock.mockResolvedValue(FACT_CATALOG);
    policy = {
      enabled: true,
      providerSlug: 'openrouter',
      modelId: 'recraft/recraft-v4.1',
    };
    const recraft = await resolveImageGenerationModel(ctx, ORG);
    expect(recraft).toMatchObject({
      aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      maxReferenceImages: 1,
      acceptsImageInput: true,
    });
    // A minimum of 0 marks no edit model.
    expect(recraft?.minReferenceImages).toBeUndefined();
    // A model that reads images but takes none to draw from takes no
    // reference image; a model with no published facts keeps the defaults.
    policy = {
      enabled: true,
      providerSlug: 'openrouter',
      modelId: 'qwen/qwen-image-3',
    };
    await expect(resolveImageGenerationModel(ctx, ORG)).resolves.toMatchObject({
      maxReferenceImages: 0,
      acceptsImageInput: false,
    });
    policy = {
      enabled: true,
      providerSlug: 'openrouter',
      modelId: 'black-forest-labs/flux.2-pro',
    };
    const flux = await resolveImageGenerationModel(ctx, ORG);
    expect(flux?.aspectRatios).toBeUndefined();
    expect(flux?.maxReferenceImages).toBeUndefined();
    expect(flux?.acceptsImageInput).toBe(true);
  });
});

describe('inspectImageGenerationModels', () => {
  it('lists every admitted model and the current pick, without secrets', async () => {
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([OPENROUTER, OPENAI, LOCAL]);
    const status = await inspectImageGenerationModels(ctx, ORG);
    expect(status).toEqual({
      enabled: true,
      models: [
        {
          providerSlug: 'local-images',
          providerDisplayName: 'Local images',
          modelId: 'google/gemini-2.5-flash-image',
        },
        {
          providerSlug: 'openai',
          providerDisplayName: 'OpenAI',
          modelId: 'gpt-image-1-mini',
        },
        {
          providerSlug: 'openai',
          providerDisplayName: 'OpenAI',
          modelId: 'gpt-image-2.5-flare',
        },
        {
          providerSlug: 'openai',
          providerDisplayName: 'OpenAI',
          modelId: 'gpt-image-2.5-sunburst',
        },
        {
          providerSlug: 'openrouter',
          providerDisplayName: 'OpenRouter',
          modelId: 'black-forest-labs/flux.2-pro',
        },
        {
          providerSlug: 'openrouter',
          providerDisplayName: 'OpenRouter',
          modelId: 'google/gemini-2.5-flash-image',
        },
      ],
      pick: {
        providerSlug: 'openrouter',
        modelId: 'google/gemini-2.5-flash-image',
        source: 'preferred',
      },
    });
    expect(JSON.stringify(status)).not.toContain('sk-test');
  });

  it('shows what automatic would pick while the policy is off', async () => {
    resolveProvidersMock.mockResolvedValue([OPENAI]);
    await expect(inspectImageGenerationModels(ctx, ORG)).resolves.toMatchObject(
      {
        enabled: false,
        pick: { modelId: 'gpt-image-2.5-flare', source: 'preferred' },
      },
    );
  });

  it('carries an unservable pin as its code, keeping the list', async () => {
    policy = {
      enabled: true,
      providerSlug: 'removed',
      modelId: 'old-image-model',
    };
    resolveProvidersMock.mockResolvedValue([OPENAI]);
    await expect(inspectImageGenerationModels(ctx, ORG)).resolves.toMatchObject(
      {
        enabled: true,
        pick: null,
        error: { code: 'IMAGE_GENERATION_MODEL_UNAVAILABLE' },
      },
    );
  });
});

describe('resolveImageGenerationModel — the EU/EEA rule [GOV-R17]', () => {
  const OPENROUTER_EU = {
    name: 'openrouter-eu',
    displayName: 'OpenRouter EU',
    apiFormat: 'openai',
    baseUrl: 'https://eu.openrouter.ai/api/v1',
    catalog: { source: 'openrouter-api' },
  };
  const USER = { id: 'user_1', type: 'user' } as const;
  const PIN_OPENAI = {
    enabled: true,
    providerSlug: 'openai',
    modelId: 'gpt-image-2.5-sunburst',
  };

  beforeEach(() => {
    endpointPolicy = { kind: 'eu', attestedHosts: [] };
    catalogMock.mockImplementation(async (provider: { name: string }) =>
      provider.name === OPENROUTER_EU.name
        ? [image('black-forest-labs/flux.2-pro')]
        : (CATALOGS[provider.name] ?? []),
    );
  });

  it('refuses a pinned model on a vendor’s global endpoint, and audits who asked', async () => {
    policy = PIN_OPENAI;
    resolveProvidersMock.mockResolvedValue([OPENAI]);
    const refused = resolveImageGenerationModel(ctx, ORG, { actor: USER });
    await expect(refused).rejects.toBeInstanceOf(ModelEndpointRefusal);
    await expect(refused).rejects.toMatchObject({
      data: {
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        provider: 'openai',
        host: 'api.openai.com',
        reason: 'vendor-global',
        message: expect.stringContaining('eu.api.openai.com'),
      },
    });
    expect(runMutation).toHaveBeenCalledTimes(1);
    const [ref, entry] = runMutation.mock.calls[0] ?? [];
    expect(shimFunctionName(ref)).toBe(
      'governance/internal_mutations:recordModelEndpointRefusal',
    );
    expect(entry).toMatchObject({
      organizationId: ORG,
      surface: 'image-generation',
      provider: 'openai',
      model: 'gpt-image-2.5-sunburst',
      host: 'api.openai.com',
      code: 'MODEL_ENDPOINT_OUTSIDE_EU',
      actor: USER,
    });
  });

  it('serves a pinned model through the vendor’s EU endpoint', async () => {
    policy = PIN_OPENAI;
    credentialMock.mockResolvedValue({
      ...apiKey(),
      endpointUrl: 'https://eu.api.openai.com/v1',
    });
    resolveProvidersMock.mockResolvedValue([OPENAI]);
    await expect(
      resolveImageGenerationModel(ctx, ORG, { actor: USER }),
    ).resolves.toMatchObject({
      modelId: 'gpt-image-2.5-sunburst',
      baseUrl: 'https://eu.api.openai.com/v1',
      source: 'pinned',
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('serves a custom provider only once an admin attests its host', async () => {
    policy = {
      enabled: true,
      providerSlug: 'local-images',
      modelId: 'google/gemini-2.5-flash-image',
    };
    resolveProvidersMock.mockResolvedValue([LOCAL]);
    await expect(resolveImageGenerationModel(ctx, ORG)).rejects.toMatchObject({
      data: {
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        host: 'images.internal.example',
        reason: 'not-attested',
      },
    });
    endpointPolicy = { kind: 'eu', attestedHosts: ['images.internal.example'] };
    await expect(resolveImageGenerationModel(ctx, ORG)).resolves.toMatchObject({
      providerSlug: 'local-images',
      baseUrl: 'https://images.internal.example/v1',
    });
  });

  it('passes over refused models for the best one the rule lets through', async () => {
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([OPENROUTER, OPENAI, OPENROUTER_EU]);
    await expect(resolveImageGenerationModel(ctx, ORG)).resolves.toMatchObject({
      providerSlug: 'openrouter-eu',
      modelId: 'black-forest-labs/flux.2-pro',
      baseUrl: 'https://eu.openrouter.ai/api/v1',
      wire: 'openrouter-images',
      source: 'preferred',
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('refuses the best model when the rule lets none through', async () => {
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([OPENAI, OPENROUTER]);
    await expect(
      resolveImageGenerationModel(ctx, ORG, { actor: USER }),
    ).rejects.toMatchObject({
      data: {
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        provider: 'openrouter',
        host: 'openrouter.ai',
        message: expect.stringContaining('eu.openrouter.ai'),
      },
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        surface: 'image-generation',
        provider: 'openrouter',
        model: 'google/gemini-2.5-flash-image',
        actor: USER,
      }),
    );
  });

  it('says resolution failed, not refused, when a failed provider might have served', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([OPENROUTER, OPENROUTER_EU]);
    catalogMock.mockImplementation(async (provider: { name: string }) => {
      if (provider.name === OPENROUTER_EU.name) {
        throw new Error('catalog down');
      }
      return CATALOGS[provider.name] ?? [];
    });
    expect(await codeOf(resolveImageGenerationModel(ctx, ORG))).toBe(
      'IMAGE_GENERATION_RESOLUTION_FAILED',
    );
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('refuses every model, an EU endpoint too, while the policy cannot be read', async () => {
    endpointPolicy = { kind: 'unreadable' };
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([OPENROUTER_EU]);
    await expect(resolveImageGenerationModel(ctx, ORG)).rejects.toMatchObject({
      data: { code: 'MODEL_ENDPOINT_POLICY_UNREADABLE' },
    });
  });

  it('offers a turn no tool the rule refuses, and writes no audit entry for it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([OPENROUTER]);
    await expect(
      resolveImageGenerationModel(ctx, ORG, { offer: true }),
    ).rejects.toBeInstanceOf(ModelEndpointRefusal);
    await expect(resolveTurnImageGeneration(ctx, ORG)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('not offered'),
      'MODEL_ENDPOINT_OUTSIDE_EU',
    );
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('shows the settings the refusal instead of a pick, without an audit entry', async () => {
    policy = PIN_OPENAI;
    resolveProvidersMock.mockResolvedValue([OPENAI]);
    await expect(inspectImageGenerationModels(ctx, ORG)).resolves.toMatchObject(
      {
        enabled: true,
        pick: null,
        error: { code: 'MODEL_ENDPOINT_OUTSIDE_EU' },
      },
    );
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('offers the settings only the models the rule lets through, and says why [GOV-R22]', async () => {
    policy = { enabled: true };
    resolveProvidersMock.mockResolvedValue([OPENAI, OPENROUTER_EU]);
    const eu = await inspectImageGenerationModels(ctx, ORG);
    expect(eu.models.length).toBeGreaterThan(0);
    expect(
      eu.models.every((model) => model.providerSlug === 'openrouter-eu'),
    ).toBe(true);
    expect(eu.modelsHiddenBy).toBe('eu');

    endpointPolicy = { kind: 'unreadable' };
    await expect(inspectImageGenerationModels(ctx, ORG)).resolves.toMatchObject(
      { models: [], modelsHiddenBy: 'unreadable' },
    );

    endpointPolicy = { kind: 'open' };
    const open = await inspectImageGenerationModels(ctx, ORG);
    expect(new Set(open.models.map((model) => model.providerSlug))).toEqual(
      new Set(['openai', 'openrouter-eu']),
    );
    expect(open.modelsHiddenBy).toBeUndefined();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('changes nothing while the rule is off', async () => {
    endpointPolicy = { kind: 'open' };
    policy = PIN_OPENAI;
    resolveProvidersMock.mockResolvedValue([OPENAI]);
    await expect(
      resolveImageGenerationModel(ctx, ORG, { actor: USER }),
    ).resolves.toMatchObject({ baseUrl: 'https://api.openai.com/v1' });
    expect(runMutation).not.toHaveBeenCalled();
  });
});
