/**
 * The TTS model resolver walks the org's providers for the first
 * text-to-speech entry a DIRECT credential can serve, then picks voice and
 * instructions by locale → base language → default. These tests pin the
 * fallback ladder and the two coded refusals (`UNKNOWN_VOICE`,
 * `NO_PROVIDER`) — the codes fan out to every org member via chunk rows,
 * so they are contract, not detail.
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
vi.mock('./catalog_fetch', () => ({
  getProviderCatalog: (...args: unknown[]) => catalogMock(...(args as [])),
}));

const credentialMock = vi.fn();
vi.mock('../../provider_credentials/resolve_credential', () => ({
  resolveProviderCredential: (...args: unknown[]) =>
    credentialMock(...(args as [])),
}));

import { resolveTtsModel } from './resolve_tts_model';

const ctx = {} as ActionCtx;
const ORG = 'org_a';

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
    credentialMock.mockResolvedValue({
      authMethod: 'subscription',
      secret: 'oauth-token',
    });

    expect(
      await caughtCode(
        resolveTtsModel(ctx, { organizationId: ORG, locale: 'en' }),
      ),
    ).toBe('NO_PROVIDER');
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
