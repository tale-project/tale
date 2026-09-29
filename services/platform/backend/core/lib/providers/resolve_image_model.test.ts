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
const runQuery = vi.fn(
  async (
    _ref: unknown,
    args: { providerSlug?: string; policyType?: string },
  ) => {
    if (args.policyType !== undefined) {
      if (policy instanceof Error) throw policy;
      return policy;
    }
    const slug = args.providerSlug ?? '';
    return slug in defaultRows ? defaultRows[slug] : ACTIVE_API_KEY_ROW;
  },
);
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runQuery is exercised by this module
const ctx = { runQuery } as unknown as ActionCtx;

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
    image('gpt-image-1', {
      pricing: {
        inputCentsPerMillion: 500,
        outputCentsPerMillion: 4000,
        imageInputCentsPerMillion: 1000,
      },
    }),
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
  defaultRows = {};
  policy = null;
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
      { enabled: false, providerSlug: 'openai', modelId: 'gpt-image-1' },
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
    policy = { enabled: true, providerSlug: 'openai', modelId: 'gpt-image-1' };
    resolveProvidersMock.mockResolvedValue([OPENROUTER, OPENAI]);
    const resolved = await resolveImageGenerationModel(ctx, ORG);
    expect(resolved).toMatchObject({
      providerSlug: 'openai',
      modelId: 'gpt-image-1',
      source: 'pinned',
      wire: 'openai-images',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      acceptsImageInput: true,
      pricing: {
        inputCentsPerMillion: 500,
        outputCentsPerMillion: 4000,
        imageInputCentsPerMillion: 1000,
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
        modelId: 'gpt-image-1',
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
    policy = { enabled: true, providerSlug: 'openai', modelId: 'gpt-image-1' };
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
      modelId: 'gpt-image-1-mini',
      source: 'preferred',
    });
  });

  it('honours the credential allowlist', async () => {
    policy = { enabled: true };
    defaultRows = {
      openai: { ...ACTIVE_API_KEY_ROW, modelAllowlist: ['gpt-image-1'] },
    };
    resolveProvidersMock.mockResolvedValue([OPENAI]);
    await expect(resolveImageGenerationModel(ctx, ORG)).resolves.toMatchObject({
      modelId: 'gpt-image-1',
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
          modelId: 'gpt-image-1',
        },
        {
          providerSlug: 'openai',
          providerDisplayName: 'OpenAI',
          modelId: 'gpt-image-1-mini',
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
        pick: { modelId: 'gpt-image-1-mini', source: 'preferred' },
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
