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
import { classifyTranscriptionError } from '../errors/classify_transcription_error';
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
let endpointPolicy: ModelEndpointPolicy = { kind: 'open' };
const runQuery = vi.fn(
  async (ref: unknown, args: { providerSlug: string; policyType?: string }) => {
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
    return args.providerSlug in defaultRows
      ? defaultRows[args.providerSlug]
      : ACTIVE_API_KEY_ROW;
  },
);
// The EU/EEA rule's audit entry for a refused model (GOV-R17).
const runMutation = vi.fn(async (_ref: unknown, _args: unknown) => null);
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runQuery and the refusal's audit entry are exercised by this module
const ctx = { runQuery, runMutation } as unknown as ActionCtx;

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
  runMutation.mockClear();
  defaultRows = {};
  policy = null;
  endpointPolicy = { kind: 'open' };
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
    // provider is skipped before any credential or catalog read. The reads
    // are the pin, OpenAI's default credential and the EU/EEA rule.
    expect(runQuery).toHaveBeenCalledTimes(3);
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

  // A default credential whose secret the resolver refuses until an admin
  // acts — re-entered after a key rotation, an env var set — used to count
  // as a resolution failure: "temporarily unavailable" on dictation and
  // three scheduled retries of every upload, each answering the same
  // refusal. It serves nothing, exactly like no default credential.
  describe('a credential the resolver refuses for good', () => {
    const refusal = (code: string) =>
      new AppError({ code, message: `synthetic ${code} refusal` });

    it.each(['CREDENTIAL_KEY_ROTATED', 'CREDENTIAL_ENV_UNSET'])(
      'reads %s as no model in Auto — terminal, never retried',
      async (code) => {
        resolveProvidersMock.mockResolvedValue([provider('openai')]);
        catalogMock.mockResolvedValue([WHISPER]);
        credentialMock.mockRejectedValue(refusal(code));

        const thrown = await resolveTranscriptionModel(ctx, {
          organizationId: ORG,
        }).catch((error: unknown) => error);
        expect(await caughtCode(Promise.reject(thrown))).toBe(
          'NO_TRANSCRIPTION_MODEL',
        );
        expect(classifyTranscriptionError(thrown).shouldRetry).toBe(false);
        expect(await inspectTranscriptionModels(ctx, ORG)).toEqual({
          models: [],
          pick: null,
          error: { code: 'NO_TRANSCRIPTION_MODEL' },
        });
      },
    );

    it('falls through to a healthy provider in Auto', async () => {
      resolveProvidersMock.mockResolvedValue([
        provider('alpha'),
        provider('zulu'),
      ]);
      catalogMock.mockResolvedValue([WHISPER]);
      credentialMock.mockImplementation(
        async (_ctx: unknown, args: { providerSlug: string }) => {
          if (args.providerSlug === 'alpha') {
            throw refusal('CREDENTIAL_KEY_ROTATED');
          }
          return apiKeyCredential();
        },
      );
      expect(
        await resolveTranscriptionModel(ctx, { organizationId: ORG }),
      ).toMatchObject({ providerName: 'zulu' });
    });

    it('refuses the pin as unavailable, never redirecting it', async () => {
      policy = { providerSlug: 'pinned', modelId: 'whisper-1' };
      resolveProvidersMock.mockResolvedValue([
        provider('alternative'),
        provider('pinned'),
      ]);
      catalogMock.mockResolvedValue([WHISPER]);
      credentialMock.mockRejectedValue(refusal('CREDENTIAL_ENV_UNSET'));

      const thrown = await resolveTranscriptionModel(ctx, {
        organizationId: ORG,
      }).catch((error: unknown) => error);
      expect(await caughtCode(Promise.reject(thrown))).toBe(
        'TRANSCRIPTION_MODEL_UNAVAILABLE',
      );
      expect(classifyTranscriptionError(thrown).shouldRetry).toBe(false);
    });

    it('still retries a broker pool that is only cooling down', async () => {
      resolveProvidersMock.mockResolvedValue([provider('openai')]);
      catalogMock.mockResolvedValue([WHISPER]);
      credentialMock.mockRejectedValue(refusal('CREDENTIAL_BROKER_EXHAUSTED'));

      expect(
        await caughtCode(
          resolveTranscriptionModel(ctx, { organizationId: ORG }),
        ),
      ).toBe('TRANSCRIPTION_MODEL_RESOLUTION_FAILED');
    });
  });
});

describe('resolveTranscriptionModel — the EU/EEA rule [GOV-R17]', () => {
  const USER = { id: 'user_1', type: 'user' } as const;
  const OPENAI_GLOBAL = {
    ...provider('openai'),
    baseUrl: 'https://api.openai.com/v1',
  };

  beforeEach(() => {
    endpointPolicy = { kind: 'eu', attestedHosts: [] };
    catalogMock.mockResolvedValue([WHISPER]);
    credentialMock.mockResolvedValue(apiKeyCredential());
  });

  it('refuses a pinned model on a vendor’s global endpoint, never retried, and audits who asked', async () => {
    policy = { providerSlug: 'openai', modelId: 'whisper-1' };
    resolveProvidersMock.mockResolvedValue([OPENAI_GLOBAL]);
    const thrown = await resolveTranscriptionModel(ctx, {
      organizationId: ORG,
      actor: USER,
    }).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(ModelEndpointRefusal);
    expect(thrown).toMatchObject({
      data: {
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        provider: 'openai',
        host: 'api.openai.com',
        reason: 'vendor-global',
        message: expect.stringContaining('eu.api.openai.com'),
      },
    });
    expect(classifyTranscriptionError(thrown)).toEqual({
      shouldRetry: false,
      reason: 'model_endpoint_refused',
    });
    expect(runMutation).toHaveBeenCalledTimes(1);
    const [ref, entry] = runMutation.mock.calls[0] ?? [];
    expect(shimFunctionName(ref)).toBe(
      'governance/internal_mutations:recordModelEndpointRefusal',
    );
    expect(entry).toMatchObject({
      organizationId: ORG,
      surface: 'transcription',
      provider: 'openai',
      model: 'whisper-1',
      host: 'api.openai.com',
      code: 'MODEL_ENDPOINT_OUTSIDE_EU',
      actor: USER,
    });
  });

  it('transcribes through the vendor’s EU endpoint', async () => {
    policy = { providerSlug: 'openai', modelId: 'whisper-1' };
    resolveProvidersMock.mockResolvedValue([OPENAI_GLOBAL]);
    credentialMock.mockResolvedValue({
      ...apiKeyCredential(),
      endpointUrl: 'https://eu.api.openai.com/v1',
    });
    await expect(
      resolveTranscriptionModel(ctx, { organizationId: ORG, actor: USER }),
    ).resolves.toMatchObject({ baseUrl: 'https://eu.api.openai.com/v1' });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('passes over a refused model in Automatic for one the rule lets through', async () => {
    endpointPolicy = { kind: 'eu', attestedHosts: ['zulu.example'] };
    resolveProvidersMock.mockResolvedValue([
      provider('alpha'),
      provider('zulu'),
    ]);
    await expect(
      resolveTranscriptionModel(ctx, { organizationId: ORG }),
    ).resolves.toMatchObject({
      providerName: 'zulu',
      baseUrl: 'https://zulu.example/v1',
    });
    expect((await inspectTranscriptionModels(ctx, ORG)).pick).toEqual({
      providerSlug: 'zulu',
      modelId: 'whisper-1',
      source: 'automatic',
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('offers the settings only the models the rule lets through, and says why [GOV-R22]', async () => {
    endpointPolicy = { kind: 'eu', attestedHosts: ['zulu.example'] };
    resolveProvidersMock.mockResolvedValue([
      provider('alpha'),
      provider('zulu'),
    ]);
    const eu = await inspectTranscriptionModels(ctx, ORG);
    expect(eu.models.map((model) => model.providerSlug)).toEqual(['zulu']);
    expect(eu.modelsHiddenBy).toBe('eu');

    endpointPolicy = { kind: 'unreadable' };
    await expect(inspectTranscriptionModels(ctx, ORG)).resolves.toMatchObject({
      models: [],
      modelsHiddenBy: 'unreadable',
    });

    endpointPolicy = { kind: 'open' };
    const open = await inspectTranscriptionModels(ctx, ORG);
    expect(open.models.map((model) => model.providerSlug)).toEqual([
      'alpha',
      'zulu',
    ]);
    expect(open.modelsHiddenBy).toBeUndefined();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('refuses Automatic’s first model when the rule lets none through', async () => {
    resolveProvidersMock.mockResolvedValue([
      provider('alpha'),
      provider('zulu'),
    ]);
    await expect(
      resolveTranscriptionModel(ctx, { organizationId: ORG }),
    ).rejects.toMatchObject({
      data: {
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        provider: 'alpha',
        host: 'alpha.example',
        reason: 'not-attested',
      },
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ surface: 'transcription', provider: 'alpha' }),
    );
  });

  it('says resolution failed, not refused, when a failed provider might have served', async () => {
    resolveProvidersMock.mockResolvedValue([
      provider('broken'),
      provider('refused'),
    ]);
    catalogMock.mockImplementation(async (p: { name: string }) => {
      if (p.name === 'broken') throw new Error('catalog unreachable');
      return [WHISPER];
    });
    expect(
      await caughtCode(resolveTranscriptionModel(ctx, { organizationId: ORG })),
    ).toBe('TRANSCRIPTION_MODEL_RESOLUTION_FAILED');
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('refuses every model, an EU endpoint too, while the policy cannot be read', async () => {
    endpointPolicy = { kind: 'unreadable' };
    resolveProvidersMock.mockResolvedValue([
      { ...provider('openai'), baseUrl: 'https://eu.api.openai.com/v1' },
    ]);
    const thrown = await resolveTranscriptionModel(ctx, {
      organizationId: ORG,
    }).catch((error: unknown) => error);
    expect(thrown).toMatchObject({
      data: { code: 'MODEL_ENDPOINT_POLICY_UNREADABLE' },
    });
    expect(classifyTranscriptionError(thrown).shouldRetry).toBe(false);
  });

  it('shows the settings the refusal instead of a pick, without an audit entry', async () => {
    resolveProvidersMock.mockResolvedValue([provider('alpha')]);
    await expect(inspectTranscriptionModels(ctx, ORG)).resolves.toMatchObject({
      pick: null,
      error: { code: 'MODEL_ENDPOINT_OUTSIDE_EU' },
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('changes nothing while the rule is off', async () => {
    endpointPolicy = { kind: 'open' };
    resolveProvidersMock.mockResolvedValue([OPENAI_GLOBAL]);
    await expect(
      resolveTranscriptionModel(ctx, { organizationId: ORG, actor: USER }),
    ).resolves.toMatchObject({ baseUrl: 'https://api.openai.com/v1' });
    expect(runMutation).not.toHaveBeenCalled();
  });
});
