/**
 * The TTS model resolver walks the org's providers for the first
 * text-to-speech entry the provider's DIRECT default credential can serve —
 * its model allowlist applied the way the composer's `voice.ttsAvailable`
 * flag applies it — then picks voice and instructions by locale → base
 * language → default. These tests pin the fallback ladder, the allowlist
 * agreement, and the two coded refusals (`UNKNOWN_VOICE`, `NO_PROVIDER`) —
 * the codes fan out to every org member via chunk rows, so they are
 * contract, not detail.
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

import { shimFunctionName } from '../../../lib/ctx-shim';
import {
  type ModelEndpointPolicy,
  ModelEndpointRefusal,
} from '../../governance/model_endpoint_gate';
import { errorCodeFromCaught } from '../../tts/error_codes';
import { resolveTtsModel } from './resolve_tts_model';

const ORG = 'org_a';
const ACTIVE_API_KEY_ROW = { authMethod: 'api-key', status: 'active' };

/** The provider's default credential row, keyed by provider slug; a
 * provider not listed gets an active api-key row without an allowlist. */
let defaultRows: Record<string, unknown> = {};
let endpointPolicy: ModelEndpointPolicy = { kind: 'open' };
const runQuery = vi.fn(async (ref: unknown, args: { providerSlug: string }) => {
  if (
    shimFunctionName(ref) ===
    'governance/internal_queries:getModelEndpointPolicyInternal'
  ) {
    return endpointPolicy;
  }
  return args.providerSlug in defaultRows
    ? defaultRows[args.providerSlug]
    : ACTIVE_API_KEY_ROW;
});
// The EU/EEA rule's audit entry for a refused model (GOV-R17).
const runMutation = vi.fn(async (_ref: unknown, _args: unknown) => null);
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runQuery and the refusal's audit entry are exercised by this module
const ctx = { runQuery, runMutation } as unknown as ActionCtx;

function provider(name: string, baseUrl = `https://${name}.example/v1`) {
  return { name, baseUrl };
}

function ttsEntry(overrides?: Record<string, unknown>) {
  return {
    id: 'gpt-4o-mini-tts',
    tags: ['text-to-speech'],
    tts: {
      defaultVoice: 'alloy',
      voicesByLocale: { de: 'onyx', 'fr-CA': 'nova' },
      defaultInstructions: 'Speak naturally.',
      instructionsByLocale: { de: 'Sprich natürlich.' },
      audioFormat: 'mp3',
      centsPerMillionCharacters: 1200,
    },
    ...overrides,
  };
}

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
  endpointPolicy = { kind: 'open' };
});

describe('resolveTtsModel', () => {
  it('resolves the first text-to-speech entry with an exact-locale voice', async () => {
    resolveProvidersMock.mockResolvedValue([provider('openai')]);
    catalogMock.mockResolvedValue([
      { id: 'gpt-4o', tags: ['chat'] },
      ttsEntry(),
    ]);
    credentialMock.mockResolvedValue(apiKeyCredential());

    const resolved = await resolveTtsModel(ctx, {
      organizationId: ORG,
      locale: 'de',
    });
    expect(resolved).toEqual({
      modelId: 'gpt-4o-mini-tts',
      providerName: 'openai',
      baseUrl: 'https://openai.example/v1',
      apiKey: 'sk-test',
      voice: 'onyx',
      audioFormat: 'mp3',
      instructions: 'Sprich natürlich.',
      centsPerMillionCharacters: 1200,
    });
  });

  it('falls back exact locale → base language → default voice', async () => {
    resolveProvidersMock.mockResolvedValue([provider('openai')]);
    catalogMock.mockResolvedValue([ttsEntry()]);
    credentialMock.mockResolvedValue(apiKeyCredential());

    // de-CH has no exact mapping; base "de" wins.
    const deCh = await resolveTtsModel(ctx, {
      organizationId: ORG,
      locale: 'de-CH',
    });
    expect(deCh.voice).toBe('onyx');

    // en has neither exact nor base mapping; the default voice wins.
    const en = await resolveTtsModel(ctx, {
      organizationId: ORG,
      locale: 'en',
    });
    expect(en.voice).toBe('alloy');
    expect(en.instructions).toBe('Speak naturally.');
  });

  it('throws UNKNOWN_VOICE when the entry declares no usable voice', async () => {
    resolveProvidersMock.mockResolvedValue([provider('openai')]);
    catalogMock.mockResolvedValue([ttsEntry({ tts: {} })]);
    credentialMock.mockResolvedValue(apiKeyCredential());

    expect(
      await caughtCode(
        resolveTtsModel(ctx, { organizationId: ORG, locale: 'en' }),
      ),
    ).toBe('UNKNOWN_VOICE');
  });

  it('skips subscription credentials and unreachable catalogs, then refuses with NO_PROVIDER', async () => {
    resolveProvidersMock.mockResolvedValue([
      provider('anthropic'),
      provider('copilot'),
      provider('chat-only'),
    ]);
    catalogMock.mockImplementation(async (c: { name: string }) => {
      if (c.name === 'anthropic') throw new Error('catalog unreachable');
      if (c.name === 'copilot') return [ttsEntry()];
      return [{ id: 'gpt-4o', tags: ['chat'] }];
    });
    // Copilot serves TTS but only via a subscription harness — unusable
    // for a plain HTTP synthesis call.
    defaultRows = {
      copilot: { authMethod: 'subscription-key', status: 'active' },
    };
    credentialMock.mockResolvedValue({
      authMethod: 'subscription',
      secret: 'oauth-token',
    });

    expect(
      await caughtCode(
        resolveTtsModel(ctx, { organizationId: ORG, locale: 'en' }),
      ),
    ).toBe('NO_PROVIDER');
    // The subscription default is out before its catalog is even read.
    expect(catalogMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'copilot' }),
      undefined,
    );
  });

  it('never fetches a catalog for a provider without an active direct default credential', async () => {
    resolveProvidersMock.mockResolvedValue([
      provider('no-credential'),
      provider('disabled'),
    ]);
    defaultRows = {
      'no-credential': null,
      disabled: { authMethod: 'api-key', status: 'disabled' },
    };
    catalogMock.mockResolvedValue([ttsEntry()]);

    expect(
      await caughtCode(
        resolveTtsModel(ctx, { organizationId: ORG, locale: 'en' }),
      ),
    ).toBe('NO_PROVIDER');
    expect(catalogMock).not.toHaveBeenCalled();
    expect(credentialMock).not.toHaveBeenCalled();
  });

  it('refuses a voice model the allowlist of the default credential excludes, as the composer flag does', async () => {
    resolveProvidersMock.mockResolvedValue([provider('openai')]);
    defaultRows = {
      openai: { ...ACTIVE_API_KEY_ROW, modelAllowlist: ['gpt-4o'] },
    };
    catalogMock.mockResolvedValue([
      { id: 'gpt-4o', tags: ['chat'] },
      ttsEntry(),
    ]);
    credentialMock.mockResolvedValue(apiKeyCredential());

    expect(
      await caughtCode(
        resolveTtsModel(ctx, { organizationId: ORG, locale: 'en' }),
      ),
    ).toBe('NO_PROVIDER');
    // The catalog is read through the servable seam WITH the allowlist —
    // the same read the composer's listing makes.
    expect(catalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'openai' }),
      ['gpt-4o'],
    );
    expect(credentialMock).not.toHaveBeenCalled();
  });

  it('serves the voice model when the allowlist names it', async () => {
    resolveProvidersMock.mockResolvedValue([provider('openai')]);
    defaultRows = {
      openai: { ...ACTIVE_API_KEY_ROW, modelAllowlist: ['gpt-4o-mini-tts'] },
    };
    catalogMock.mockResolvedValue([
      { id: 'gpt-4o', tags: ['chat'] },
      ttsEntry(),
    ]);
    credentialMock.mockResolvedValue(apiKeyCredential());

    const resolved = await resolveTtsModel(ctx, {
      organizationId: ORG,
      locale: 'en',
    });
    expect(resolved.modelId).toBe('gpt-4o-mini-tts');
  });

  it('prefers the requested provider and applies mp3 as the format default', async () => {
    resolveProvidersMock.mockResolvedValue([
      provider('openai'),
      provider('elevenlabs'),
    ]);
    catalogMock.mockImplementation(async (c: { name: string }) => [
      c.name === 'elevenlabs'
        ? ttsEntry({
            id: 'eleven-v3',
            tts: { defaultVoice: 'rachel' },
          })
        : ttsEntry(),
    ]);
    credentialMock.mockResolvedValue(apiKeyCredential());

    const resolved = await resolveTtsModel(ctx, {
      organizationId: ORG,
      locale: 'en',
      providerName: 'elevenlabs',
    });
    expect(resolved.providerName).toBe('elevenlabs');
    expect(resolved.modelId).toBe('eleven-v3');
    expect(resolved.audioFormat).toBe('mp3');
    expect(resolved.centsPerMillionCharacters).toBeUndefined();
  });
});

describe('resolveTtsModel — the EU/EEA rule [GOV-R17]', () => {
  const USER = { id: 'user_1', type: 'user' } as const;
  const OPENAI_GLOBAL = provider('openai', 'https://api.openai.com/v1');

  beforeEach(() => {
    endpointPolicy = { kind: 'eu', attestedHosts: [] };
    catalogMock.mockResolvedValue([ttsEntry()]);
    credentialMock.mockResolvedValue(apiKeyCredential());
  });

  it('passes over a provider the rule refuses for one it lets through', async () => {
    resolveProvidersMock.mockResolvedValue([
      OPENAI_GLOBAL,
      provider('mistral', 'https://api.eu.mistral.ai/v1'),
    ]);
    await expect(
      resolveTtsModel(ctx, { organizationId: ORG, locale: 'en', actor: USER }),
    ).resolves.toMatchObject({
      providerName: 'mistral',
      baseUrl: 'https://api.eu.mistral.ai/v1',
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('refuses with the first refused provider when no other can speak, and audits who asked', async () => {
    resolveProvidersMock.mockResolvedValue([OPENAI_GLOBAL, provider('house')]);
    const thrown = await resolveTtsModel(ctx, {
      organizationId: ORG,
      locale: 'en',
      actor: USER,
    }).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(ModelEndpointRefusal);
    expect(thrown).toMatchObject({
      data: {
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        provider: 'openai',
        host: 'api.openai.com',
        reason: 'vendor-global',
      },
    });
    // The chunk rows carry the closed code the client explains.
    expect(errorCodeFromCaught(thrown)).toEqual({ code: 'REGION_POLICY' });
    expect(runMutation).toHaveBeenCalledTimes(1);
    const [ref, entry] = runMutation.mock.calls[0] ?? [];
    expect(shimFunctionName(ref)).toBe(
      'governance/internal_mutations:recordModelEndpointRefusal',
    );
    expect(entry).toMatchObject({
      organizationId: ORG,
      surface: 'speech',
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      host: 'api.openai.com',
      code: 'MODEL_ENDPOINT_OUTSIDE_EU',
      actor: USER,
    });
  });

  it('speaks through a host an admin attested', async () => {
    endpointPolicy = { kind: 'eu', attestedHosts: ['house.example'] };
    resolveProvidersMock.mockResolvedValue([provider('house')]);
    await expect(
      resolveTtsModel(ctx, { organizationId: ORG, locale: 'en' }),
    ).resolves.toMatchObject({ providerName: 'house' });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('refuses every provider, an EU endpoint too, while the policy cannot be read', async () => {
    endpointPolicy = { kind: 'unreadable' };
    resolveProvidersMock.mockResolvedValue([
      provider('openai', 'https://eu.api.openai.com/v1'),
    ]);
    const thrown = await resolveTtsModel(ctx, {
      organizationId: ORG,
      locale: 'en',
    }).catch((error: unknown) => error);
    expect(thrown).toMatchObject({
      data: { code: 'MODEL_ENDPOINT_POLICY_UNREADABLE' },
    });
    expect(errorCodeFromCaught(thrown)).toEqual({ code: 'REGION_POLICY' });
  });

  it('still says NO_PROVIDER when no provider could speak at all', async () => {
    resolveProvidersMock.mockResolvedValue([OPENAI_GLOBAL]);
    catalogMock.mockResolvedValue([{ id: 'gpt-4o', tags: ['chat'] }]);
    expect(
      await caughtCode(
        resolveTtsModel(ctx, { organizationId: ORG, locale: 'en' }),
      ),
    ).toBe('NO_PROVIDER');
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('changes nothing while the rule is off', async () => {
    endpointPolicy = { kind: 'open' };
    resolveProvidersMock.mockResolvedValue([OPENAI_GLOBAL]);
    await expect(
      resolveTtsModel(ctx, { organizationId: ORG, locale: 'en', actor: USER }),
    ).resolves.toMatchObject({ baseUrl: 'https://api.openai.com/v1' });
    expect(runMutation).not.toHaveBeenCalled();
  });
});
