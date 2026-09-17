/**
 * The transcription model resolver walks the org's `openai`-format providers
 * for the first `transcription`-tagged entry the provider's DIRECT default
 * credential can serve — its model allowlist applied the way the composer's
 * `voice.transcriptionAvailable` flag applies it, so the dictation button,
 * the upload pipeline, and this resolver never disagree. These tests pin
 * the walk, the allowlist agreement, and the `NO_TRANSCRIPTION_MODEL`
 * refusal.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../../lib/shared/errors/app-error';
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
vi.mock('../../provider_credentials/resolve_credential', () => ({
  resolveProviderCredential: (...args: unknown[]) =>
    credentialMock(...(args as [])),
}));

import {
  inspectTranscriptionModels,
  resolveTranscriptionModel,
} from './resolve_transcription_model';

const ORG = 'org_a';
const ACTIVE_API_KEY_ROW = { authMethod: 'api-key', status: 'active' };

/** The provider's default credential row, keyed by provider slug; a
 * provider not listed gets an active api-key row without an allowlist. */
let defaultRows: Record<string, unknown> = {};
let policy: unknown = null;
const runQuery = vi.fn(
  async (
    _ref: unknown,
    args: { providerSlug: string; policyType?: string },
  ) => {
    if (args.policyType !== undefined) {
      if (policy instanceof Error) throw policy;
      return policy;
    }
    return args.providerSlug in defaultRows
      ? defaultRows[args.providerSlug]
      : ACTIVE_API_KEY_ROW;
  },
);
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runQuery is exercised by this module
const ctx = { runQuery } as unknown as ActionCtx;

function provider(name: string, apiFormat: 'openai' | 'anthropic' = 'openai') {
  return {
    name,
    displayName: name,
    apiFormat,
    baseUrl: `https://${name}.example/v1`,
    catalog: { source: 'static' },
  };
}

const WHISPER = { id: 'whisper-1', tags: ['transcription'] };
const CHAT_ONLY = { id: 'gpt-4o', tags: ['chat'] };

function apiKeyCredential(secret = 'sk-test') {
  return { authMethod: 'api-key', secret, endpointUrl: undefined };
}

async function caughtCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) {
      const data: unknown = err.data;
      if (data && typeof data === 'object' && 'code' in data) {
        const code = (data as { code?: unknown }).code;
        if (typeof code === 'string') return code;
      }
    }
    throw err;
  }
  throw new Error('expected the resolver to throw');
}

beforeEach(() => {
  resolveProvidersMock.mockReset();
  catalogMock.mockReset();
  credentialMock.mockReset();
  runQuery.mockClear();
  defaultRows = {};
  policy = null;
});

describe('resolveTranscriptionModel', () => {
  it('resolves the first transcription entry a direct default credential serves', async () => {
    resolveProvidersMock.mockResolvedValue([
      provider('anthropic', 'anthropic'),
      provider('openai'),
    ]);
    catalogMock.mockResolvedValue([CHAT_ONLY, WHISPER]);
    credentialMock.mockResolvedValue(apiKeyCredential());

    const resolved = await resolveTranscriptionModel(ctx, {
      organizationId: ORG,
    });
    expect(resolved).toEqual({
      modelId: 'whisper-1',
      providerName: 'openai',
      baseUrl: 'https://openai.example/v1',
      apiKey: 'sk-test',
    });
    // The Anthropic Messages format has no transcription endpoint: that
    // provider is skipped before any credential or catalog read.
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(catalogMock).toHaveBeenCalledTimes(1);
  });

  it('prefers the credential endpoint over the provider base URL', async () => {
    resolveProvidersMock.mockResolvedValue([provider('azure')]);
    catalogMock.mockResolvedValue([WHISPER]);
    credentialMock.mockResolvedValue({
      ...apiKeyCredential(),
      endpointUrl: 'https://tenant.openai.azure.com/openai',
    });

    const resolved = await resolveTranscriptionModel(ctx, {
      organizationId: ORG,
    });
    expect(resolved.baseUrl).toBe('https://tenant.openai.azure.com/openai');
  });

  it.each([
    { ...provider('openrouter'), catalog: { source: 'openrouter-api' } },
    { ...provider('router-alias'), catalog: { source: 'openrouter-api' } },
    { ...provider('router-alias'), baseUrl: 'https://openrouter.ai/api/v1' },
  ])('selects portable JSON for OpenRouter provider $name', async (router) => {
    resolveProvidersMock.mockResolvedValue([router]);
    catalogMock.mockResolvedValue([
      { ...WHISPER, id: 'openai/gpt-4o-mini-transcribe' },
    ]);
    credentialMock.mockResolvedValue(apiKeyCredential());
    expect(
      await resolveTranscriptionModel(ctx, { organizationId: ORG }),
    ).toMatchObject({
      providerName: router.name,
      modelId: 'openai/gpt-4o-mini-transcribe',
      responseFormat: 'json',
    });
  });

  it('never fetches a catalog for a provider without an active direct default credential', async () => {
    resolveProvidersMock.mockResolvedValue([
      provider('no-credential'),
      provider('disabled'),
      provider('subscription'),
    ]);
    defaultRows = {
      'no-credential': null,
      disabled: { authMethod: 'api-key', status: 'disabled' },
      subscription: { authMethod: 'subscription-key', status: 'active' },
    };
    catalogMock.mockResolvedValue([WHISPER]);

    expect(
      await caughtCode(resolveTranscriptionModel(ctx, { organizationId: ORG })),
    ).toBe('NO_TRANSCRIPTION_MODEL');
    expect(catalogMock).not.toHaveBeenCalled();
    expect(credentialMock).not.toHaveBeenCalled();
  });

  it('distinguishes an unreachable catalog from no configured model', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveProvidersMock.mockResolvedValue([
      provider('flaky'),
      provider('chat-only'),
    ]);
    catalogMock.mockImplementation(async (c: { name: string }) => {
      if (c.name === 'flaky') throw new Error('catalog unreachable');
      return [CHAT_ONLY];
    });

    expect(
      await caughtCode(resolveTranscriptionModel(ctx, { organizationId: ORG })),
    ).toBe('TRANSCRIPTION_MODEL_RESOLUTION_FAILED');
    expect(credentialMock).not.toHaveBeenCalled();
  });

  it('refuses a transcription model the allowlist of the default credential excludes, as the composer flag does', async () => {
    resolveProvidersMock.mockResolvedValue([provider('openai')]);
    defaultRows = {
      openai: { ...ACTIVE_API_KEY_ROW, modelAllowlist: ['gpt-4o'] },
    };
    catalogMock.mockResolvedValue([CHAT_ONLY, WHISPER]);
    credentialMock.mockResolvedValue(apiKeyCredential());

    expect(
      await caughtCode(resolveTranscriptionModel(ctx, { organizationId: ORG })),
    ).toBe('NO_TRANSCRIPTION_MODEL');
    // The catalog is read through the servable seam WITH the allowlist —
    // the same read the composer's listing makes.
    expect(catalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'openai' }),
      ['gpt-4o'],
      { requiredCapability: 'transcription' },
    );
    expect(credentialMock).not.toHaveBeenCalled();
  });

  it('serves the transcription model when the allowlist names it', async () => {
    resolveProvidersMock.mockResolvedValue([provider('openai')]);
    defaultRows = {
      openai: { ...ACTIVE_API_KEY_ROW, modelAllowlist: ['whisper-1'] },
    };
    catalogMock.mockResolvedValue([CHAT_ONLY, WHISPER]);
    credentialMock.mockResolvedValue(apiKeyCredential());

    const resolved = await resolveTranscriptionModel(ctx, {
      organizationId: ORG,
    });
    expect(resolved.modelId).toBe('whisper-1');
  });

  it('uses a stable automatic pick and exposes only non-secret metadata', async () => {
    resolveProvidersMock.mockResolvedValue([
      provider('zulu'),
      provider('alpha'),
    ]);
    catalogMock.mockResolvedValue([
      { ...WHISPER, id: 'z-model' },
      { ...WHISPER, id: 'a-model' },
      { id: 'speech-generator', tags: ['text-to-speech'] },
    ]);
    credentialMock.mockResolvedValue(
      apiKeyCredential('private-transcription-token'),
    );
    const status = await inspectTranscriptionModels(ctx, ORG);
    expect(status.pick).toEqual({
      providerSlug: 'alpha',
      modelId: 'a-model',
      source: 'automatic',
    });
    expect(
      status.models.map((model) => `${model.providerSlug}/${model.modelId}`),
    ).toEqual([
      'alpha/a-model',
      'alpha/z-model',
      'zulu/a-model',
      'zulu/z-model',
    ]);
    expect(JSON.stringify(status)).not.toMatch(
      /private-transcription-token|baseUrl|apiKey|resolved/,
    );
    expect(
      await resolveTranscriptionModel(ctx, { organizationId: ORG }),
    ).toMatchObject({
      providerName: status.pick?.providerSlug,
      modelId: status.pick?.modelId,
    });
  });

  it('honors a pin over the automatic order, then restores Auto with an empty policy', async () => {
    resolveProvidersMock.mockResolvedValue([
      provider('alpha'),
      provider('zulu'),
    ]);
    catalogMock.mockResolvedValue([WHISPER]);
    credentialMock.mockResolvedValue(apiKeyCredential());
    policy = { providerSlug: 'zulu', modelId: 'whisper-1' };
    expect(
      await resolveTranscriptionModel(ctx, { organizationId: ORG }),
    ).toMatchObject({ providerName: 'zulu' });
    expect(catalogMock).toHaveBeenCalledTimes(1);
    expect((await inspectTranscriptionModels(ctx, ORG)).pick).toEqual({
      providerSlug: 'zulu',
      modelId: 'whisper-1',
      source: 'pinned',
    });
    policy = {};
    expect(
      await resolveTranscriptionModel(ctx, { organizationId: ORG }),
    ).toMatchObject({ providerName: 'alpha' });
  });

  it('honors namespaced model IDs exactly, including when the selected sibling disappears', async () => {
    policy = { providerSlug: 'pinned', modelId: 'b/whisper-1' };
    resolveProvidersMock.mockResolvedValue([provider('pinned')]);
    defaultRows.pinned = ACTIVE_API_KEY_ROW;
    credentialMock.mockResolvedValue(apiKeyCredential());
    catalogMock.mockResolvedValue([
      { ...WHISPER, id: 'a/whisper-1' },
      { ...WHISPER, id: 'b/whisper-1' },
    ]);
    expect(
      await resolveTranscriptionModel(ctx, { organizationId: ORG }),
    ).toMatchObject({ modelId: 'b/whisper-1' });
    expect((await inspectTranscriptionModels(ctx, ORG)).pick?.modelId).toBe(
      'b/whisper-1',
    );
    catalogMock.mockResolvedValue([{ ...WHISPER, id: 'a/whisper-1' }]);
    expect(
      await caughtCode(resolveTranscriptionModel(ctx, { organizationId: ORG })),
    ).toBe('TRANSCRIPTION_MODEL_UNAVAILABLE');
    expect((await inspectTranscriptionModels(ctx, ORG)).pick).toBeNull();
  });

  it.each(['missing', 'disabled', 'allowlist', 'non-transcription'])(
    'refuses an unavailable %s pin despite a healthy alternative',
    async (kind) => {
      policy = { providerSlug: 'pinned', modelId: 'whisper-1' };
      resolveProvidersMock.mockResolvedValue([
        provider('alternative'),
        ...(kind === 'missing' ? [] : [provider('pinned')]),
      ]);
      defaultRows.pinned =
        kind === 'disabled'
          ? { ...ACTIVE_API_KEY_ROW, status: 'disabled' }
          : {
              ...ACTIVE_API_KEY_ROW,
              ...(kind === 'allowlist' ? { modelAllowlist: ['other'] } : {}),
            };
      catalogMock.mockImplementation(async (p: { name: string }) =>
        kind === 'non-transcription' && p.name === 'pinned'
          ? [CHAT_ONLY]
          : [WHISPER],
      );
      credentialMock.mockResolvedValue(apiKeyCredential());
      expect(
        await caughtCode(
          resolveTranscriptionModel(ctx, { organizationId: ORG }),
        ),
      ).toBe('TRANSCRIPTION_MODEL_UNAVAILABLE');
      expect((await inspectTranscriptionModels(ctx, ORG)).pick).toBeNull();
    },
  );

  it.each([
    [
      'half pin',
      { providerSlug: 'pinned' },
      'TRANSCRIPTION_MODEL_POLICY_INVALID',
    ],
    [
      'misspelled pin',
      { provider: 'pinned' },
      'TRANSCRIPTION_MODEL_POLICY_INVALID',
    ],
    [
      'unreadable file',
      new Error('private policy bytes'),
      'TRANSCRIPTION_MODEL_POLICY_UNAVAILABLE',
    ],
  ])('never converts %s into Automatic', async (_name, value, code) => {
    policy = value;
    resolveProvidersMock.mockResolvedValue([provider('alternative')]);
    catalogMock.mockResolvedValue([WHISPER]);
    credentialMock.mockResolvedValue(apiKeyCredential());
    expect(
      await caughtCode(resolveTranscriptionModel(ctx, { organizationId: ORG })),
    ).toBe(code);
    expect(credentialMock).not.toHaveBeenCalled();
    const status = await inspectTranscriptionModels(ctx, ORG);
    expect(status).toMatchObject({ pick: null, error: { code } });
    expect(status.models).toHaveLength(1);
    expect(JSON.stringify(status)).not.toContain('private policy bytes');
  });

  it('skips a broken provider in Auto but never redirects a pin', async () => {
    resolveProvidersMock.mockResolvedValue([
      provider('broken'),
      provider('healthy'),
    ]);
    catalogMock.mockImplementation(async (p: { name: string }) => {
      if (p.name === 'broken') throw new Error('private upstream response');
      return [WHISPER];
    });
    credentialMock.mockResolvedValue(apiKeyCredential());
    expect(
      await resolveTranscriptionModel(ctx, { organizationId: ORG }),
    ).toMatchObject({ providerName: 'healthy' });
    policy = { providerSlug: 'broken', modelId: 'whisper-1' };
    const status = await inspectTranscriptionModels(ctx, ORG);
    expect(status).toMatchObject({
      pick: null,
      error: { code: 'TRANSCRIPTION_MODEL_RESOLUTION_FAILED' },
    });
    expect(JSON.stringify(status)).not.toContain('private upstream response');
  });

  it('excludes unusable credentials and metadata hosts from settings as well as serving', async () => {
    resolveProvidersMock.mockResolvedValue([
      provider('broken-key'),
      provider('metadata'),
    ]);
    catalogMock.mockResolvedValue([WHISPER]);
    credentialMock.mockImplementation(
      async (_ctx: unknown, args: { providerSlug: string }) => {
        if (args.providerSlug === 'broken-key')
          throw new Error('private decryption input');
        return {
          ...apiKeyCredential(),
          endpointUrl: 'http://169.254.169.254/v1',
        };
      },
    );
    const status = await inspectTranscriptionModels(ctx, ORG);
    expect(status).toEqual({
      models: [],
      pick: null,
      error: { code: 'TRANSCRIPTION_MODEL_RESOLUTION_FAILED' },
    });
    expect(
      await caughtCode(resolveTranscriptionModel(ctx, { organizationId: ORG })),
    ).toBe('TRANSCRIPTION_MODEL_RESOLUTION_FAILED');
  });
});
